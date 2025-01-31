from sqlalchemy.orm import Session
import zipfile
import os
from database import SessionLocal, User,Verse,Chapter,Job
# import logging
import requests
import time
import shutil
import subprocess
from fastapi import  HTTPException
from pathlib import Path
from database import Project ,Book
import json
from dotenv import load_dotenv
import librosa
import soundfile as sf
from dependency import logger, LOG_FOLDER
import re



load_dotenv()

# logging.basicConfig(level=logging.DEBUG)

BASE_DIRECTORY = os.getenv("BASE_DIRECTORY")
if not BASE_DIRECTORY:
    raise ValueError("The environment variable 'BASE_DIRECTORY' is not set.")
BASE_DIR = Path(BASE_DIRECTORY)

# Regex pattern for valid verse file formats (ignores extension)
VALID_VERSE_PATTERN = re.compile(r"^\d+_\d+(?:_\d+)?(?:_default)?$")



# Directory for extracted files
UPLOAD_DIR = "Input"
os.makedirs(UPLOAD_DIR, exist_ok=True)

def process_project_files(input_path, output_path, db, project):
    """
    Process the files in the extracted project directory and populate the database.
    """
    incompartible_verses = []
    try:
        # Locate the project directory within `input_path`
       # Normalize the project directory structure
        extracted_items = list(input_path.iterdir())
        if len(extracted_items) == 1 and extracted_items[0].is_dir():
            # Case: Single folder encapsulating everything
            project_input_path = extracted_items[0]
            next_folder = extracted_items[0]
            if(next_folder.name == input_path.name):
                logger.info(f"Duplicate folder detected: {next_folder}")
                for sub_item in next_folder.iterdir():
                    target_path = input_path / sub_item.name
                    if target_path.exists():
                        logger.warning(f"Conflict while moving {sub_item} to {target_path}, skipping.")
                    else:
                        shutil.move(str(sub_item), str(target_path))
                next_folder.rmdir()
                logger.info(f"Resolved duplicate folder: {next_folder}")
                project_input_path = input_path
            else:
                logger.info("No duplicate folder found.")
        elif any((input_path / item).exists() for item in ["audio", "text-1", "metadata.json"]):
            # Case: Direct structure with `audio`, `text-1`, and `metadata.json`
            project_input_path = input_path
        else:
            logger.error("Unexpected folder structure in the input path.")
            raise HTTPException(
                status_code=400, detail="Please upload Scribe's - Scripture Burrito validated zip file"
            )
        if not project_input_path or not project_input_path.is_dir():
            logger.error("Project directory not found under input path.")
            raise HTTPException(status_code=400, detail="Please upload Scribe's - Scripture Burrito validated zip file")
        # Locate versification.json
        versification_path= "versification.json"
        if not versification_path:
            logger.error("versification.json not found .")
            raise HTTPException(status_code=400, detail="Please upload Scribe's - Scripture Burrito validated zip file")
        # Read versification.json
        with open(versification_path, "r", encoding="utf-8") as versification_file:
            versification_data = json.load(versification_file)
        max_verses = versification_data.get("maxVerses", {})
        # Dynamically locate the `ingredients` folder
        ingredients_path = None
        for root, dirs, files in os.walk(project_input_path):
            if "audio" in dirs and "ingredients" in os.listdir(os.path.join(root, "audio")):
                ingredients_path = Path(root) / "audio" / "ingredients"
                break
            elif "text" in dirs and "ingredients" in os.listdir(os.path.join(root, "text")):
                ingredients_path = Path(root) / "text" / "ingredients"
                break
            elif "ingredients" in dirs:
                ingredients_path = Path(root) / "ingredients"
                break
        if not ingredients_path:
            logger.error("Ingredients folder not found. Checked all possible locations.")
            raise HTTPException(status_code=400, detail="Please upload Scribe's - Scripture Burrito validated zip file")
        logger.info(f"Ingredients folder found at: {ingredients_path}")
        has_valid_books =False
        # Process books, chapters, and verses in `ingredients`
        for book_dir in ingredients_path.iterdir():
            if book_dir.is_dir():
                book_name = book_dir.name
                book_max_verses = max_verses.get(book_name, [])
                
                # Check if the book has any chapters with valid verses
                has_valid_chapters = False
                for chapter_dir in book_dir.iterdir():
                    if chapter_dir.is_dir() and chapter_dir.name.isdigit():
                        chapter_number = int(chapter_dir.name)
                        chapter_max_verses = int(book_max_verses[chapter_number - 1]) if chapter_number <= len(book_max_verses) else 0
                        # Get all available verses in the chapter
                        available_verses = set(
                            int(verse_digits.group(1))
                            for verse_file in chapter_dir.iterdir()
                            if verse_file.is_file() and "_" in verse_file.stem
                            for verse_digits in [re.match(r"^(\d+)", verse_file.stem.split("_")[1])]
                            if verse_digits
                        )
                        if available_verses:
                            has_valid_chapters = True
                            break
                # No need to check further chapters if one valid chapter is found
                if not has_valid_chapters:
                    logger.info(f"Skipping book '{book_name}' as it has no valid chapters.")
                    continue# Skip this book if no valid chapters are found
 
                # If at least one book with valid chapters is found, mark the project as valid
                has_valid_books = True
                
                # Create a book entry in the database
                book_entry = Book(
                    project_id=project.project_id,
                    book=book_name,
                    # approved=False,
                )
                db.add(book_entry)
                db.commit()
                db.refresh(book_entry)
                
                for chapter_dir in book_dir.iterdir():
                    if chapter_dir.is_dir() and chapter_dir.name.isdigit():
                        chapter_number = int(chapter_dir.name)
                        chapter_max_verses = int(book_max_verses[chapter_number - 1]) if chapter_number <= len(book_max_verses) else 0
                        
                        verse_files = {}
                        for verse_file in chapter_dir.iterdir():
                            if not verse_file.is_file():
                                continue  # Skip directories

                            # Extract filename without extension
                            verse_filename = verse_file.stem

                            # Skip files that do not match valid verse patterns
                            if not VALID_VERSE_PATTERN.match(verse_filename):
                                logger.info(f"Skipping invalid verse file: {verse_file.name}")
                                print("Skipping invalid verse file:", verse_file.name)
                                incompartible_verses.append(verse_filename)
                                continue

                            try:
                                # Extract chapter and verse numbers
                                parts = verse_filename.split("_")

                                # Ensure first part matches chapter number
                                if not (parts[0].isdigit() and int(parts[0]) == chapter_number):
                                    continue

                                # Extract verse number
                                if len(parts) >= 2 and parts[1].isdigit():
                                    verse_number = int(parts[1])
                                else:
                                    logger.warning(f"Skipping malformed verse file: {verse_file.name}")
                                    continue

                                # Determine file priority
                                if len(parts) == 2:  # Format: 1_1 (basic format)
                                    priority = 2
                                elif "default" in parts:  # Format: 1_1_1_default
                                    priority = 1
                                else:  # Format: 1_1_1 (takes format)
                                    priority = 0

                                # Store the best file for each verse based on priority
                                if verse_number not in verse_files:
                                    verse_files[verse_number] = {'file': verse_file, 'priority': priority}
                                elif priority > verse_files[verse_number]['priority']:
                                    logger.info(f"Removing lower priority verse file: {verse_files[verse_number]['file']}")
                                    os.remove(verse_files[verse_number]['file'])
                                    verse_files[verse_number] = {'file': verse_file, 'priority': priority}
                                else:
                                    logger.info(f"Removing duplicate verse file: {verse_file}")
                                    os.remove(verse_file)

                            except Exception as e:
                                logger.warning(f"Error processing verse file {verse_file.name}: {str(e)}")
                                continue  # Skip invalid files

                        # Finalize verse files after prioritization
                        selected_files = {verse: data['file'] for verse, data in verse_files.items()}

                        # Get available verses after duplicate removal
                        available_verses = set(selected_files.keys())

                        # Skip empty chapter if no valid verse files found
                        if not available_verses:
                            logger.info(f"Empty chapter detected: {chapter_dir}, deleting it.")
                            shutil.rmtree(chapter_dir)
                            continue
 
                        # Determine missing verses
                        expected_verses = set(range(1, chapter_max_verses + 1))
                        missing_verses = list(expected_verses - available_verses)
                        # Create a chapter entry in the database
                        chapter_entry = Chapter(
                            book_id=book_entry.book_id,
                            chapter=chapter_number,
                            approved=False,
                            missing_verses=missing_verses if missing_verses else None,
                        )
                        db.add(chapter_entry)
                        db.commit()
                        db.refresh(chapter_entry)
                        # Add verse records
                        for verse_number, verse_file in selected_files.items():
                            # Create a verse entry in the database  
                            verse = Verse(
                                chapter_id=chapter_entry.chapter_id,
                                verse=verse_number,
                                name=verse_file.name,
                                path=str(verse_file),
                                size=verse_file.stat().st_size,
                                format=verse_file.suffix.lstrip("."),
                                stt=False,
                                text="",
                                modified=False,
                                tts=False,
                                tts_path="",
                                stt_msg="",
                                tts_msg="",
                            )
                            db.add(verse)

        db.commit()
        print("incompartible_verses after processing:", incompartible_verses)
         # If no valid books or chapters were found, delete the project and its folder structure
        if not has_valid_books:
            logger.error("No valid books or chapters found in the project. Rolling back project creation.")
 
            # Delete the project from the database
            db.delete(project)
            db.commit()
 
            # Remove the project folder structure
            project_base_path = BASE_DIR / str(project.project_id)
            if project_base_path.exists():
                shutil.rmtree(project_base_path)
                logger.info(f"Deleted project folder: {project_base_path}")
 
            raise HTTPException(status_code=400, detail="No valid books or chapters found in the project")
    
    
    except HTTPException as http_exc:
    # If it's already an HTTPException, re-raise it without modification
        raise http_exc
 
    except Exception as e:
        logger.error(f"Error while processing project files: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    
    return {"status": "success", "incompartible_verses": incompartible_verses}

def process_chapters(book_folder, project, book_entry, db,book_name):
    """
    Process chapters: add new chapters and skip existing ones.
    """
    # Dynamically locate the ingredients folder
    base_name = project.name.split("(")[0].strip()
    project_root_path = BASE_DIR / str(project.project_id) / "input" / base_name
 
    ingredients_path = None
    if (project_root_path / "ingredients").exists():
        ingredients_path = project_root_path / "ingredients"
    elif (project_root_path / "audio" / "ingredients").exists():
        ingredients_path = project_root_path / "audio" / "ingredients"
    else:
        ingredients_path = project_root_path / "ingredients"
        ingredients_path.mkdir(parents=True, exist_ok=True)
 
    target_book_path = ingredients_path / book_entry.book
    target_book_path.mkdir(parents=True, exist_ok=True)
    
    # Fetch existing chapters
    existing_chapters = {
        chapter.chapter for chapter in db.query(Chapter).filter(Chapter.book_id == book_entry.book_id)
    }
    # Validate versification.json
    versification_path = "versification.json"
    if not Path(versification_path).exists():
        logger.error("versification.json not found.")
        raise HTTPException(status_code=400, detail="versification.json not found")

    # Read versification.json
    with open(versification_path, "r", encoding="utf-8") as versification_file:
        versification_data = json.load(versification_file)

    max_verses_data = versification_data.get("maxVerses", {})
    valid_books = set(max_verses_data.keys())

    # Validate the book name
    if book_name not in valid_books:
        logger.error(f"Invalid book code: {book_name}.")
        raise HTTPException(status_code=400, detail=f"Invalid book code: {book_name}")

    max_chapters = len(max_verses_data[book_name])
    max_verses_per_chapter = {
        chapter_num + 1: int(verses)
        for chapter_num, verses in enumerate(max_verses_data[book_name])
    }
    added_chapters = []
    # Process chapters in the book folder
    skipped_chapters = []
    
    incompartible_verses = []
    
    for chapter_dir in book_folder.iterdir():
        if chapter_dir.is_dir() and chapter_dir.name.isdigit():
            chapter_number = int(chapter_dir.name)
            # Check if the chapter exceeds the maximum allowed chapters
            if chapter_number > max_chapters:
                logger.error(f"Invalid chapter {chapter_number}: Exceeds maximum allowed chapters ({max_chapters})")
                shutil.rmtree(chapter_dir)  # Remove the invalid chapter folder
                raise HTTPException(
                    status_code=400,
                    detail=f"{book_name} should have {max_chapters} chapter(s) but found chapter {chapter_number}. "
                    "Please upload the ZIP file with proper chapter count"
                )
            
            if chapter_number in existing_chapters:
                logger.info(f"Skipping existing chapter: {chapter_number}")
                skipped_chapters.append(chapter_number)
                continue
            
            # Process verses, tracking and removing duplicates
            verse_files = {}
            for verse_file in chapter_dir.iterdir():
                if not verse_file.is_file():
                    continue  # Skip directories
                
                verse_filename = verse_file.stem
                if not VALID_VERSE_PATTERN.match(verse_filename):
                    logger.info(f"Skipping invalid verse file: {verse_file.name}")
                    print("Skipping invalid verse file:", verse_file.name)
                    incompartible_verses.append(verse_filename)
                    continue
                try:
                    # Split the filename to extract components
                    parts = verse_file.stem.split("_")
                    
                    # Ensure first part matches chapter number
                    if not (parts[0].isdigit() and int(parts[0]) == chapter_number):
                        continue
                        
                    # Extract verse number
                    if len(parts) >= 2 and parts[1].isdigit():
                        verse_number = int(parts[1])
                    else:
                        logger.warning(f"Skipping malformed verse file: {verse_file.name}")
                        continue
                        
                            
                    # Determine file priority
                    if len(parts) == 2:  # Basic format like 1_1.mp3
                        priority = 2
                    elif "default" in parts:  # Contains 'default'
                        priority = 1
                    else:  # Any other format (takes)
                        priority = 0
                        
                    # Add or replace based on priority
                    if verse_number not in verse_files:
                        # First file for this verse number
                        verse_files[verse_number] = {
                            'file': verse_file,
                            'priority': priority
                        }
                    elif priority > verse_files[verse_number]['priority']:
                        # New file has higher priority
                        logger.info(f"Removing lower priority verse file: {verse_files[verse_number]['file']}")
                        os.remove(verse_files[verse_number]['file'])
                        verse_files[verse_number] = {
                            'file': verse_file,
                            'priority': priority
                        }
                    else:
                        # Keep existing file, remove the current one
                        logger.info(f"Removing duplicate verse file: {verse_file}")
                        os.remove(verse_file)

                except (ValueError, IndexError) as e:
                    logger.warning(f"Invalid file name format: {verse_file.name}. Error: {str(e)}")
                    continue
                                
            # Finalize verse files after prioritization
            selected_files = {verse: data['file'] for verse, data in verse_files.items()}
            
            # Get available verses after duplicate removal
            available_verses = set(selected_files.keys())
            
            # If no verses are found, delete the empty chapter folder
            if not available_verses:
                logger.info(f"Empty chapter detected: {chapter_dir}, deleting it.")
                shutil.rmtree(chapter_dir)
                continue
            
            max_verses_in_chapter = max_verses_per_chapter.get(chapter_number, 0)
            # Determine missing verses
            expected_verses = set(range(1, max_verses_in_chapter + 1))
            missing_verses = list(expected_verses - available_verses)
            
            if available_verses and max(available_verses) > max_verses_in_chapter:
                logger.error(
                    f"Invalid chapter {chapter_number}: Exceeds maximum allowed verses or has no valid verses."
                )
                shutil.rmtree(chapter_dir)
                raise HTTPException(
                    status_code=400,
                    detail=f"{book_name}: Chapter {chapter_number} should have {max_verses_in_chapter} verses "
                    f"but {max(available_verses)} verses found. "
                    "Please upload the ZIP file with correct verse count",
                )
 
            # Move the new chapter folder
            target_chapter_path = target_book_path / chapter_dir.name
            shutil.move(str(chapter_dir), str(target_chapter_path))
            logger.info(f"Added new chapter: {chapter_number}")
            added_chapters.append(chapter_number)
            # Add the chapter and its verses to the database
            chapter_entry = Chapter(book_id=book_entry.book_id, 
                                chapter=chapter_number, 
                                approved=False, 
                                missing_verses=missing_verses if missing_verses else None
                            )
            db.add(chapter_entry)
            db.commit()
            db.refresh(chapter_entry)
 
            # Add verses
            for verse_file in target_chapter_path.iterdir():
                try: 
                    if not verse_file.is_file():
                        continue
                    if not VALID_VERSE_PATTERN.match(verse_file.stem):
                        logger.info(f"Skipping invalid verse file during database insert: {verse_file.name}")
                        continue
                    verse_number = int(verse_file.stem.split("_")[1])     
                    verse = Verse(
                        chapter_id=chapter_entry.chapter_id,
                        verse=verse_number,
                        name=verse_file.name,
                        path=str(verse_file),
                        size=verse_file.stat().st_size,
                        format=verse_file.suffix.lstrip("."),
                        stt=False,
                        text="",
                    )
                    db.add(verse)
                except (ValueError, IndexError):
                    logger.warning(f"Invalid file: {verse_file.name}")
 
    # If no chapters were added or skipped, raise an error   
    if(not added_chapters and not skipped_chapters):
        raise HTTPException(
            status_code=400,
            detail=f"No verse data found. Please upload valid ZIP file",
        ) 
    db.commit()
    return added_chapters, skipped_chapters, incompartible_verses

def transcribe_verses(file_paths: list[str], script_lang: str,db_session: Session):
    """
    Background task to transcribe verses and update the database.
    """
    try:
        for file_path in file_paths:
            # Retrieve the Verse entry based on the file path
            verse = db_session.query(Verse).filter(Verse.path == file_path).first()
            if not verse:
                logger.error(f"Verse file not found for path: {file_path}")
                continue
            
            # Clear any non-successful stt_msg before processing
            if verse.stt_msg != "Transcription successful":
                logger.debug(f"Resetting stt_msg for verse {verse.verse_id}.")
                verse.stt_msg = ""
                verse.stt = False# Resetting stt flag as well
                db_session.add(verse)
                db_session.commit()

            # Check if transcription is already successful
            if verse.stt_msg == "Transcription successful":
                logger.debug(f"Skipping transcription for verse {verse.verse_id}: Already transcribed.")
                continue

            # Create a job entry linked to the verse
            job = Job(verse_id=verse.verse_id, ai_jobid=None, status="pending")
            db_session.add(job)
            db_session.commit()
            db_session.refresh(job)
            try:
                # Call AI API for transcription
                result = call_stt_api(file_path,script_lang)
                if "error" in result:
                    # Update job and verse statuses in case of an error
                    job.status = "failed"
                    verse.stt = False
                    verse.stt_msg = result.get("error", "Unknown error")
                else:
                    # Update the job with the AI job ID
                    ai_jobid = result.get("data", {}).get("jobId")
                    job.ai_jobid = ai_jobid
                    job.status = "in_progress"
                    db_session.add(job)
                    db_session.commit()
                    # Poll AI job status until it's finished
                    while True:
                        transcription_result = check_ai_job_status(ai_jobid)
                        job_status = transcription_result.get("data", {}).get("status")
                        if job_status == "job finished":
                            # Extract transcription results
                            transcriptions = transcription_result["data"]["output"]["transcriptions"]
                            for transcription in transcriptions:
                                audio_file = transcription["audioFile"]
                                transcribed_text = transcription["transcribedText"]

                                # Update the verse text and mark as successful
                                if os.path.basename(file_path) == audio_file:
                                    verse.text = transcribed_text
                                    verse.stt = True
                                    verse.stt_msg = "Transcription successful"
                                    break

                            job.status = "completed"
                            break
                        elif job_status == "job failed":
                            job.status = "failed"
                            verse.stt = False
                            verse.stt_msg = "AI transcription failed"
                            break
                        elif job_status == "Error":
                            job.status = "failed"
                            verse.stt = False
                            verse.stt_msg = "AI transcription failed"
                            break
                        # Wait for a few seconds before polling again
                        time.sleep(5)
                # Save the updated job and verse statuses
                db_session.add(job)
                db_session.add(verse)
                db_session.commit()

            except Exception as e:
                # Handle errors during transcription
                job.status = "failed"
                verse.stt = False
                verse.stt_msg = f"Error during transcription: {str(e)}"
                db_session.add(job)
                db_session.add(verse)
                db_session.commit()
                logger.error(f"Error during transcription for verse {verse.verse_id}: {str(e)}")

    except Exception as e:
        logger.error(f"Error in transcribe_verses: {str(e)}")

    finally:
        db_session.close()



def check_ai_job_status(ai_jobid: str) -> dict:
    """
    Check the status of an AI transcription job.
    """
    job_status_url = f"https://api.vachanengine.org/v2/ai/model/job?job_id={ai_jobid}"
    headers = {"Authorization": "Bearer ory_st_mby05AoClJAHhX9Xlnsg1s0nn6Raybb3"}
    try:
        response = requests.get(job_status_url, headers=headers, timeout=30)

        if response.status_code == 200:
            return response.json()
        else:
            logger.error(f"Failed to fetch AI job status: {response.status_code} - {response.text}")
            return {"error": "Failed to fetch job status", 
                    "data": {
                        "status": "Error",
                        "details": f"Failed to fetch AI job status: {response.status_code} - {response.text}"
                    }}
    
    except requests.exceptions.Timeout:
        logger.error("Timeout while checking job status")
        return {
            "error": "Timeout Error",
            "data": {
                "status": "Error",
                "details": "Request timed out while checking job status"
            }
        }
        
    except requests.exceptions.ConnectionError:
        logger.error("Connection error while checking job status")
        return {
            "error": "Connection Error",
            "data": {
                "status": "Error",
                "details": "Failed to connect to the API"
            }
        }
        
    except Exception as e:
        logger.error(f"Unexpected error checking job status: {str(e)}")
        return {
            "error": "Unexpected Error",
            "data": {
                "status": "Error",
                "details": str(e)
            }
        }





def call_stt_api(file_path: str, script_lang: str) -> dict:
    """
     Calls the AI API to transcribe the given audio file.
    """
    # File path for the language mapping JSON
    LANGUAGE_CODES_FILE = "language_codes.json"
    
    # AI API Base URL (model_name will be dynamic)
    BASE_API_URL = "https://api.vachanengine.org/v2/ai/model/audio/transcribe"
    SERVED_MODELS_URL = "https://api.vachanengine.org/v2/ai/model/served-models"
 
 
    # API Token
    api_token = "ory_st_mby05AoClJAHhX9Xlnsg1s0nn6Raybb3"
 
    # Load the language mapping
    try:
        with open(LANGUAGE_CODES_FILE, "r") as file:
            language_mapping = json.load(file)
    except Exception as e:
        logger.error(f"Error loading language_codes.json: {str(e)}")
        return {"error": "Failed to load language mapping file", "details": str(e)}
 
    # Get the model_name and language_code dynamically
    try:
        stt_mapping = language_mapping.get(script_lang, {}).get("stt", {})
        if not stt_mapping:
            logger.error(f"No STT model found for script_lang: {script_lang}")
            return {"error": f"No STT model found for script_lang: {script_lang}"}
        
        # Select the first available model dynamically
        model_name, lang_code = next(iter(stt_mapping.items()))
        if not lang_code:
            logger.error(f"No language code found for script_lang: {script_lang}")
            return {"error": f"No language code found for script_lang: {script_lang}"}
    except Exception as e:
        logger.error(f"Error retrieving model and language code: {str(e)}")
        return {"error": "Failed to retrieve model and language code", "details": str(e)}
    
    # Check if the model is served
    try:
        headers = {"Authorization": f"Bearer {api_token}"}
        response = requests.get(SERVED_MODELS_URL, headers=headers)
        if response.status_code == 200:
            served_models = response.json()
            served_model_names = {model["modelName"] for model in served_models}
            if model_name not in served_model_names:
                logger.error(f"Model '{model_name}' is not served.")
                return {"error": f"Model '{model_name}' is not served."}
        else:
            logger.error(f"Error fetching served models: {response.status_code} - {response.text}")
            return {"error": "Failed to fetch served models", "status_code": response.status_code}
    except Exception as e:
        logger.error(f"Error checking served models: {str(e)}")
        return {"error": "Exception occurred while checking served models", "details": str(e)}
 
    # Prepare API URL
    ai_api_url = f"{BASE_API_URL}?model_name={model_name}"
 
    # Prepare the file and payload
    file_name = os.path.basename(file_path)
    try:
        with open(file_path, "rb") as audio_file:
            files_payload = {"files": (file_name, audio_file, "audio/wav")}
            data_payload = {"transcription_language": lang_code}
            headers = {"Authorization": f"Bearer {api_token}"}
 
            # Make the API request
            response = requests.post(ai_api_url, files=files_payload, data=data_payload, headers=headers)
 
        logger.info(f"AI API Response: {response.status_code} - {response.text}")
 
        # Handle API response
        if response.status_code == 201:
            return response.json()
        else:
            logger.error(f"AI API Error: {response.status_code} - {response.text}")
            return {"error": "Failed to transcribe", "status_code": response.status_code}
    except Exception as e:
        logger.error(f"Error in call_stt_api: {str(e)}")
        return {"error": "Exception occurred", "details": str(e)}




def generate_speech_for_verses(project_id: int, book_code: str, verses, audio_lang: str, db,output_format):
    """
    Generate speech for each verse and update the database, saving files in the appropriate output directory.
    """
    db_session = SessionLocal()
    extracted_folder = None
    temp_audio_dirs = []
    try:
        # Fetch the project name for creating the output path
        project = db_session.query(Project).filter(Project.project_id == project_id).first()
        if not project:
            raise HTTPException(status_code=404, detail=f"Project {project_id} not found.")

        base_name = project.name.split("(")[0].strip()
        # Base directory for output
        output_base_dir = BASE_DIR / str(project_id) / "output" / base_name
        ingredients_audio_dir = output_base_dir / "audio" / "ingredients"
        ingredients_audio_dir.mkdir(parents=True, exist_ok=True)
        temp_audio_dirs = []
        
        for verse in verses:
            if verse.tts_msg != "Text-to-speech completed":
                logger.debug(f"Resetting tts_msg for verse {verse.verse_id}.")
                verse.tts_msg = ""
                verse.tts = False # Resetting tts flag as well
                db_session.add(verse)
                db_session.commit()
 
        for verse in verses:
            try:
                chapter = db_session.query(Chapter).filter(Chapter.chapter_id == verse.chapter_id).first()
                if not chapter:
                    logger.error(f"Chapter not found for verse ID {verse.verse_id}")
                    continue
 
                # Create a job entry linked to the verse
                job = Job(verse_id=verse.verse_id, ai_jobid=None, status="pending")
                db_session.add(job)
                db_session.commit()
                db_session.refresh(job)
 
                # Call AI API for text-to-speech
                result = call_tts_api([verse.text], audio_lang,output_format)
                if "error" in result:
                    # Handle API error
                    job.status = "failed"
                    verse.tts = False
                    verse.tts_msg = result.get("error", "Unknown error")
                else:
                    # Update the job with the AI job ID
                    ai_jobid = result.get("data", {}).get("jobId")
                    job.ai_jobid = ai_jobid
                    job.status = "in_progress"
                    db_session.add(job)
                    db_session.commit()
 
                    # Poll AI job status until it's finished
                    while True:
                        job_result = check_ai_job_status(ai_jobid)
                        job_status = job_result.get("data", {}).get("status")
 
                        if job_status == "job finished":
                            # Download and extract the audio ZIP file
                            audio_zip_url = f"https://api.vachanengine.org/v2/ai/assets?job_id={ai_jobid}"
                            extracted_folder = download_and_extract_audio_zip(audio_zip_url)
                            if extracted_folder:
                                temp_audio_dirs.append(extracted_folder)
                                book_folder = ingredients_audio_dir / book_code
                                chapter_folder = book_folder / str(chapter.chapter)
                                os.makedirs(chapter_folder, exist_ok=True)

                                supported_formats = ["wav", "mp3"]
                                # Find and move the audio file to the appropriate folder
                                for root, _, files in os.walk(extracted_folder):
                                    for file in files:
                                        # if file == "audio_0.wav":
                                        file_extension = file.split(".")[-1].lower()
                                        if file.startswith("audio_0") and file_extension in supported_formats:
                                            # Update filename based on the verse
                                            base_name = os.path.splitext(verse.name)[0]  # Strip existing extension
                                            # new_audio_filename = f"{base_name}.wav"  # Add .wav extension
                                            new_audio_filename = f"{base_name}.{file_extension}"
                                            new_audio_path = chapter_folder / new_audio_filename
                                            shutil.move(os.path.join(root, file), new_audio_path)
                                            new_audio_path = validate_and_resample_wav(str(new_audio_path))
                                            # Update verse information
                                            verse.tts_path = str(new_audio_path)
                                            verse.tts = True
                                            verse.tts_msg = "Text-to-speech completed"
                                            job.status = "completed"
                                            break
                            else:
                                verse.tts = False
                                verse.tts_msg = "Failed to download or extract audio ZIP"
                                job.status = "failed"
                            break
                        elif job_status == "job failed": 
                            job.status = "failed"
                            verse.tts = False
                            verse.tts_msg = "AI TTS job failed"
                            break
                        elif job_status == "Error": 
                            job.status = "failed"
                            verse.tts = False
                            verse.tts_msg = "AI TTS job failed"
                            break
                        time.sleep(5)
 
                # Save the updated job and verse statuses
                db_session.add(job)
                db_session.add(verse)
                db_session.commit()
 
            except Exception as e:
                # Handle errors during TTS
                job.status = "failed"
                verse.tts = False
                verse.tts_msg = f"Error during TTS: {str(e)}"
                db_session.add(job)
                db_session.add(verse)
                db_session.commit()
                logger.error(f"Error during TTS for verse {verse.verse_id}: {str(e)}")
 
    except Exception as e:
        logger.error(f"Error in generate_speech_for_verses: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error in generate_speech_for_verses: {str(e)}")
 
    finally:
        db_session.close()
        
        # Cleanup temporary directories
        if temp_audio_dirs:  # Check if temp directories exist
            for temp_dir in temp_audio_dirs:
                if os.path.exists(temp_dir):
                    try:
                        shutil.rmtree(temp_dir, ignore_errors=True)
                        logger.info(f"Deleted temporary folder: {temp_dir}")
                    except Exception as e:
                        logger.warning(f"Failed to delete temporary folder {temp_dir}: {str(e)}")
 
        # Ensure extracted_folder is valid before referencing
        if extracted_folder and os.path.exists(extracted_folder):
            input_folder = os.path.dirname(extracted_folder)  # Get parent folder of extracted folder
            try:
                shutil.rmtree(input_folder, ignore_errors=True)
                logger.info(f"Deleted Input folder: {input_folder}")
            except Exception as e:
                logger.warning(f"Failed to delete Input folder {input_folder}: {str(e)}")
        else:
            logger.info("No extracted_folder found for cleanup.")


def download_and_extract_audio_zip(audio_zip_url: str) -> str:
    """
    Downloads the audio ZIP file, extracts it, and returns the folder path where files are extracted.
    """
    headers = {"Authorization": "Bearer ory_st_mby05AoClJAHhX9Xlnsg1s0nn6Raybb3"}
    response = requests.get(audio_zip_url, stream=True,headers=headers)
    if response.status_code == 200:
        # Save the ZIP file locally
        zip_file_path = f"{UPLOAD_DIR}/audio_temp.zip"
        with open(zip_file_path, "wb") as zip_file:
            for chunk in response.iter_content(chunk_size=1024):
                zip_file.write(chunk)
        # Extract the ZIP file
        extract_path = f"{UPLOAD_DIR}/temp_audio"
        os.makedirs(extract_path, exist_ok=True)
        with zipfile.ZipFile(zip_file_path, "r") as zip_ref:
            zip_ref.extractall(extract_path)
        os.remove(zip_file_path)
        return extract_path
    else:
        logger.error(f"Failed to download audio ZIP file: {response.status_code} - {response.text}")
        return None



def find_audio_file(folder_path: str, verse_name: str) -> str:
    """
    Match the verse with an audio file in the extracted folder. 
    If files are generic (e.g., 'audio_0.wav'), use order to map.
    """
    for root, dirs, files in os.walk(folder_path):
        logger.info(f"Searching in folder: {root}, Files: {files}")
        # If there is a single audio file, assume it's for the current verse
        if len(files) == 1:
            return os.path.join(root, files[0])
        # If multiple files exist, attempt exact or approximate matches
        for file in files:
            if file == verse_name:
                return os.path.join(root, file)  # Exact match
            elif file.startswith("audio_") and file.endswith(".wav"):
                # Handle generic audio files (map based on verse order)
                return os.path.join(root, file)
    logger.error(f"Audio file not found for verse: {verse_name} in folder: {folder_path}")
    return None

def call_tts_api(text: str, audio_lang: str ,output_format:str) -> dict:
    """
    Call the AI API for text-to-speech.
    """
    # File path for the language mapping JSON
    LANGUAGE_CODES_FILE = "language_codes.json"
    SOURCE_LANGUAGES_FILE = "source_languages.json"
    
    # AI API Base URL
    BASE_API_URL = "https://api.vachanengine.org/v2/ai/model/audio/generate"
    SERVED_MODELS_URL = "https://api.vachanengine.org/v2/ai/model/served-models"
    # API Token
    api_token = "ory_st_mby05AoClJAHhX9Xlnsg1s0nn6Raybb3"
 
    # Load the language mapping
    try:
        with open(LANGUAGE_CODES_FILE, "r") as file:
            language_mapping = json.load(file)
    except Exception as e:
        logger.error(f"Error loading language_codes.json: {str(e)}")
        return {"error": "Failed to load language mapping file", "details": str(e)}
    
    # Load the source language mapping
    try:
        with open(SOURCE_LANGUAGES_FILE, "r") as file:
            source_language_mapping = json.load(file)
    except Exception as e:
        logger.error(f"Error loading source_languages.json: {str(e)}")
        return {"error": "Failed to load source language mapping file", "details": str(e)}
 
    # Map audio_lang to source_language
    source_language = None
    for item in source_language_mapping:
        if item["language_name"] == audio_lang:
            source_language = item["source_language"]
            break
 
    if not source_language:
        logger.error(f"No source language found for audio_lang: {audio_lang}")
        return {"error": f"No source language found for audio_lang: {audio_lang}"}
 
    # Get the model_name and language_code dynamically
    try:
        tts_mapping = language_mapping.get(source_language, {}).get("tts", {})
        if not tts_mapping:
            logger.error(f"No TTS model found for source_language: {source_language}")
            return {"error": f"No TTS model found for audio_lang: {source_language}"}
        
        # Select the first available model dynamically
        model_name, lang_code = next(iter(tts_mapping.items()))
        print("MODELNAME,LANGUAGECODE",model_name, lang_code)
        if not lang_code:
            logger.error(f"No language code found for source_language: {source_language}")
            return {"error": f"No language code found for source_language: {source_language}"}
    except Exception as e:
        logger.error(f"Error retrieving model and language code: {str(e)}")
        return {"error": "Failed to retrieve model and language code", "details": str(e)}
    
    # Check if the model is served
    try:
        headers = {"Authorization": f"Bearer {api_token}"}
        response = requests.get(SERVED_MODELS_URL, headers=headers)
        if response.status_code == 200:
            served_models = response.json()
            served_model_names = {model["modelName"] for model in served_models}
            if model_name not in served_model_names:
                logger.error(f"Model '{model_name}' is not served.")
                return {"error": f"Model '{model_name}' is not served."}
        else:
            logger.error(f"Error fetching served models: {response.status_code} - {response.text}")
            return {"error": "Failed to fetch served models", "status_code": response.status_code}
    except Exception as e:
        logger.error(f"Error checking served models: {str(e)}")
        return {"error": "Exception occurred while checking served models", "details": str(e)}
 
    # Prepare API parameters and headers
    params = {
        "model_name": model_name,
        "language": lang_code,  # Dynamically mapped language code
        "output_format": output_format, 
    }
    data_payload = [text]
    headers = {"Authorization": f"Bearer {api_token}"}
 
    try:
        # Make the API request
        response = requests.post(BASE_API_URL, params=params, json=data_payload, headers=headers)
        logger.info(f"AI API Response: {response.status_code} - {response.text}")
 
        # Handle API response
        if response.status_code == 201:
            return response.json()
        else:
            logger.error(f"AI API Error: {response.status_code} - {response.text}")
            return {"error": response.text, "status_code": response.status_code}
    except Exception as e:
        logger.error(f"Error in call_tts_api: {str(e)}")
        return {"error": str(e)}


def validate_and_resample_wav(file_path: str) -> str:
    """
    Validate WAV file sample rate and resample to 48000 Hz if necessary using librosa.
    Args:
        file_path (str): Path to the original WAV file.
    Returns:
        str: Path to the processed WAV file.
    """
    try:
        # Load the audio file with librosa
        audio_data, sample_rate = librosa.load(file_path, sr=None, mono=True)
        logger.debug(f"Current sample rate: {sample_rate} Hz")

        # Resample only if not 48000 Hz
        if sample_rate != 48000:
            logger.info(f"Resampling audio from {sample_rate} Hz to 48000 Hz")
            audio_data_resampled = librosa.resample(audio_data, orig_sr=sample_rate, target_sr=48000)
            
            # Save the resampled audio
            temp_resampled_path = f"{file_path}.resampled.wav"
            sf.write(temp_resampled_path, audio_data_resampled, 48000, format="WAV")
            logger.info(f"Resampled WAV file saved to: {temp_resampled_path}")

            # Replace the original file with the resampled file
            os.replace(temp_resampled_path, file_path)
        else:
            logger.info("File already has a sample rate of 48000 Hz. No resampling needed.")
    except Exception as e:
        logger.error(f"Error during resampling: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to validate or resample WAV audio file")

    return file_path