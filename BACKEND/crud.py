
from sqlalchemy.orm import Session
import zipfile
import os
from database import SessionLocal, User,Verse,Chapter,Job
import logging
import requests
import time
import shutil
import subprocess
from fastapi import  HTTPException
from pathlib import Path
from database import Project ,Book
import json
from dotenv import load_dotenv



load_dotenv()

logging.basicConfig(level=logging.DEBUG)

BASE_DIRECTORY = os.getenv("BASE_DIRECTORY")
if not BASE_DIRECTORY:
    raise ValueError("The environment variable 'BASE_DIRECTORY' is not set.")
BASE_DIR = Path(BASE_DIRECTORY)




# Directory for extracted files
UPLOAD_DIR = "Input"
os.makedirs(UPLOAD_DIR, exist_ok=True)




def process_project_files(input_path, output_path, db, project):
    """
    Process the files in the extracted project directory and populate the database.
    """
    try:
        # Locate the project directory within `input_path`
        project_input_path = next(input_path.iterdir(), None)
        if not project_input_path or not project_input_path.is_dir():
            logging.error("Project directory not found under input path.")
            raise HTTPException(status_code=400, detail="Project directory not found under input path")
        # Locate versification.json
        versification_path = next(project_input_path.rglob("versification.json"), None)
        if not versification_path:
            logging.error("versification.json not found in the project folder.")
            raise HTTPException(status_code=400, detail="versification.json not found in the project folder")
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
            logging.error("Ingredients folder not found. Checked all possible locations.")
            raise HTTPException(status_code=400, detail="ingredients folder not found in the project folder")
        logging.info(f"Ingredients folder found at: {ingredients_path}")
        # Process books, chapters, and verses in `ingredients`
        for book_dir in ingredients_path.iterdir():
            if book_dir.is_dir():
                book_name = book_dir.name
                book_max_verses = max_verses.get(book_name, [])
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
                        # Get all available verses in the chapter
                        available_verses = set(
                            int(verse_file.stem.split("_")[1])
                            for verse_file in chapter_dir.iterdir()
                            if verse_file.is_file() and "_" in verse_file.stem
                        )
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
                        for verse_file in chapter_dir.iterdir():
                            if verse_file.is_file() and "_" in verse_file.stem:
                                try:
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
                                        modified=False,
                                        tts=False,
                                        tts_path="",
                                        stt_msg="",
                                        tts_msg="",
                                    )
                                    db.add(verse)
                                except ValueError:
                                    logging.warning(f"Invalid file name format: {verse_file.name}")
                                    continue
        db.commit()
    except Exception as e:
        logging.error(f"Error while processing project files: {str(e)}") 
        raise HTTPException(status_code=500, detail="Error while processing project files")

def transcribe_verses(file_paths: list[str], script_lang: str,db_session: Session):
    """
    Background task to transcribe verses and update the database.
    """
    try:
        for file_path in file_paths:
            # Retrieve the Verse entry based on the file path
            verse = db_session.query(Verse).filter(Verse.path == file_path).first()
            if not verse:
                logging.error(f"Verse file not found for path: {file_path}")
                continue
            # Create a job entry linked to the verse
            job = Job(verse_id=verse.verse_id, ai_jobid=None, status="pending")
            db_session.add(job)
            db_session.commit()
            db_session.refresh(job)
            try:
                # Call AI API for transcription
                result = call_ai_api(file_path,script_lang)
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
                logging.error(f"Error during transcription for verse {verse.verse_id}: {str(e)}")

    except Exception as e:
        logging.error(f"Error in transcribe_verses: {str(e)}")

    finally:
        db_session.close()



def check_ai_job_status(ai_jobid: str) -> dict:
    """
    Check the status of an AI transcription job.
    """
    job_status_url = f"https://api.vachanengine.org/v2/ai/model/job?job_id={ai_jobid}"
    headers = {"Authorization": "Bearer ory_st_mby05AoClJAHhX9Xlnsg1s0nn6Raybb3"}
    response = requests.get(job_status_url, headers=headers)

    if response.status_code == 200:
        return response.json()
    else:
        logging.error(f"Failed to fetch AI job status: {response.status_code} - {response.text}")
        return {"error": "Failed to fetch job status"}





def call_ai_api(file_path: str, script_lang: str) -> dict:
    """
     Calls the AI API to transcribe the given audio file.
    """
    # File path for the language mapping JSON
    LANGUAGE_CODES_FILE = "language_codes.json"
    
    # AI API Base URL (model_name will be dynamic)
    BASE_API_URL = "https://api.vachanengine.org/v2/ai/model/audio/transcribe"
 
    # API Token
    api_token = "ory_st_mby05AoClJAHhX9Xlnsg1s0nn6Raybb3"
 
    # Load the language mapping
    try:
        with open(LANGUAGE_CODES_FILE, "r") as file:
            language_mapping = json.load(file)
    except Exception as e:
        logging.error(f"Error loading language_codes.json: {str(e)}")
        return {"error": "Failed to load language mapping file", "details": str(e)}
 
    # Get the model_name and language_code dynamically
    try:
        stt_mapping = language_mapping.get(script_lang, {}).get("stt", {})
        if not stt_mapping:
            logging.error(f"No STT model found for script_lang: {script_lang}")
            return {"error": f"No STT model found for script_lang: {script_lang}"}
        
        # Select the first available model dynamically
        model_name, lang_code = next(iter(stt_mapping.items()))
        if not lang_code:
            logging.error(f"No language code found for script_lang: {script_lang}")
            return {"error": f"No language code found for script_lang: {script_lang}"}
    except Exception as e:
        logging.error(f"Error retrieving model and language code: {str(e)}")
        return {"error": "Failed to retrieve model and language code", "details": str(e)}
 
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
 
        logging.info(f"AI API Response: {response.status_code} - {response.text}")
 
        # Handle API response
        if response.status_code == 201:
            return response.json()
        else:
            logging.error(f"AI API Error: {response.status_code} - {response.text}")
            return {"error": "Failed to transcribe", "status_code": response.status_code}
    except Exception as e:
        logging.error(f"Error in call_ai_api: {str(e)}")
        return {"error": "Exception occurred", "details": str(e)}



def generate_speech_for_verses(project_id: int, book_code: str, verses, audio_lang: str, db):
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
 
        # Base directory for output
        output_base_dir = BASE_DIR / str(project_id) / "output" / project.name
        ingredients_audio_dir = output_base_dir / "audio" / "ingredients"
        ingredients_audio_dir.mkdir(parents=True, exist_ok=True)
        temp_audio_dirs = []
 
        for verse in verses:
            try:
                chapter = db_session.query(Chapter).filter(Chapter.chapter_id == verse.chapter_id).first()
                if not chapter:
                    logging.error(f"Chapter not found for verse ID {verse.verse_id}")
                    continue
 
                # Create a job entry linked to the verse
                job = Job(verse_id=verse.verse_id, ai_jobid=None, status="pending")
                db_session.add(job)
                db_session.commit()
                db_session.refresh(job)
 
                # Call AI API for text-to-speech
                result = call_tts_api([verse.text], audio_lang)
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
                                # Find and move the audio file to the appropriate folder
                                for root, _, files in os.walk(extracted_folder):
                                    for file in files:
                                        if file == "audio_0.wav":
                                            # Update filename based on the verse
                                            base_name = os.path.splitext(verse.name)[0]  # Strip existing extension
                                            new_audio_filename = f"{base_name}.wav"  # Add .wav extension
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
                logging.error(f"Error during TTS for verse {verse.verse_id}: {str(e)}")
 
    except Exception as e:
        logging.error(f"Error in generate_speech_for_verses: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error in generate_speech_for_verses: {str(e)}")
 
    finally:
        db_session.close()
        
        # Cleanup temporary directories
        if temp_audio_dirs:  # Check if temp directories exist
            for temp_dir in temp_audio_dirs:
                if os.path.exists(temp_dir):
                    try:
                        shutil.rmtree(temp_dir, ignore_errors=True)
                        logging.info(f"Deleted temporary folder: {temp_dir}")
                    except Exception as e:
                        logging.warning(f"Failed to delete temporary folder {temp_dir}: {str(e)}")
 
        # Ensure extracted_folder is valid before referencing
        if extracted_folder and os.path.exists(extracted_folder):
            input_folder = os.path.dirname(extracted_folder)  # Get parent folder of extracted folder
            try:
                shutil.rmtree(input_folder, ignore_errors=True)
                logging.info(f"Deleted Input folder: {input_folder}")
            except Exception as e:
                logging.warning(f"Failed to delete Input folder {input_folder}: {str(e)}")
        else:
            logging.info("No extracted_folder found for cleanup.")


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
        logging.error(f"Failed to download audio ZIP file: {response.status_code} - {response.text}")
        return None



def find_audio_file(folder_path: str, verse_name: str) -> str:
    """
    Match the verse with an audio file in the extracted folder. 
    If files are generic (e.g., 'audio_0.wav'), use order to map.
    """
    for root, dirs, files in os.walk(folder_path):
        logging.info(f"Searching in folder: {root}, Files: {files}")
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
    logging.error(f"Audio file not found for verse: {verse_name} in folder: {folder_path}")
    return None




def call_tts_api(text: str, audio_lang: str) -> dict:
    """
    Call the AI API for text-to-speech.
    """
    # File path for the language mapping JSON
    LANGUAGE_CODES_FILE = "language_codes.json"
    
    # AI API Base URL
    BASE_API_URL = "https://api.vachanengine.org/v2/ai/model/audio/generate"
 
    # API Token
    api_token = "ory_st_mby05AoClJAHhX9Xlnsg1s0nn6Raybb3"
 
    # Load the language mapping
    try:
        with open(LANGUAGE_CODES_FILE, "r") as file:
            language_mapping = json.load(file)
    except Exception as e:
        logging.error(f"Error loading language_codes.json: {str(e)}")
        return {"error": "Failed to load language mapping file", "details": str(e)}
 
    # Get the model_name and language_code dynamically
    try:
        tts_mapping = language_mapping.get(audio_lang, {}).get("tts", {})
        if not tts_mapping:
            logging.error(f"No TTS model found for audio_lang: {audio_lang}")
            return {"error": f"No TTS model found for audio_lang: {audio_lang}"}
        
        # Select the first available model dynamically
        model_name, lang_code = next(iter(tts_mapping.items()))
        print("MODELNAME,LANGUAGECODE",model_name, lang_code)
        if not lang_code:
            logging.error(f"No language code found for audio_lang: {audio_lang}")
            return {"error": f"No language code found for audio_lang: {audio_lang}"}
    except Exception as e:
        logging.error(f"Error retrieving model and language code: {str(e)}")
        return {"error": "Failed to retrieve model and language code", "details": str(e)}
 
    # Prepare API parameters and headers
    params = {
        "model_name": model_name,
        "language": lang_code,  # Dynamically mapped language code
    }
    data_payload = [text]
    headers = {"Authorization": f"Bearer {api_token}"}
 
    try:
        # Make the API request
        response = requests.post(BASE_API_URL, params=params, json=data_payload, headers=headers)
        logging.info(f"AI API Response: {response.status_code} - {response.text}")
 
        # Handle API response
        if response.status_code == 201:
            return response.json()
        else:
            logging.error(f"AI API Error: {response.status_code} - {response.text}")
            return {"error": response.text, "status_code": response.status_code}
    except Exception as e:
        logging.error(f"Error in call_tts_api: {str(e)}")
        return {"error": str(e)}
    

def validate_and_resample_wav(file_path: str) -> str:
    """
    Validate WAV file sample rate and resample to 48000 Hz if necessary.
    Args:
        file_path (str): Path to the original WAV file.
    Returns:
        str: Path to the processed WAV file.
    """
    temp_resampled_path = f"{file_path}.resampled.wav"
    try:
        # Check the current sample rate using ffprobe
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate",
             "-of", "default=nw=1:nk=1", file_path],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        current_sample_rate = int(probe.stdout.decode().strip())
        logging.debug(f"Current sample rate: {current_sample_rate} Hz")

        # Resample only if not 48000 Hz
        if current_sample_rate != 48000:
            subprocess.run(
                [
                    "ffmpeg", "-i", file_path,
                    "-ar", "48000", "-ac", "1", "-sample_fmt", "s16",
                    temp_resampled_path, "-y"
                ],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            logging.info(f"Resampled WAV file to 48000 Hz: {temp_resampled_path}")
            os.replace(temp_resampled_path, file_path)  # Replace the original file with the resampled one
        else:
            logging.info("File already has a sample rate of 48000 Hz. No resampling needed.")
    except subprocess.CalledProcessError as e:
        logging.error(f"Failed to resample WAV file: {e.stderr.decode()}")
        raise HTTPException(status_code=500, detail="Failed to resample WAV audio file")
    return file_path
     