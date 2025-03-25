from sqlalchemy.orm import Session
import zipfile
import os
from database import SessionLocal, User,Verse,Chapter,Job
import logging
import requests
import time
import shutil
from fastapi import  HTTPException,UploadFile
from fastapi.responses import FileResponse
from pathlib import Path
from database import Project ,Book
import json
from dotenv import load_dotenv
import librosa
import soundfile as sf
from dependency import logger, LOG_FOLDER
import re
import router
import datetime
import time
from language import language_codes, source_languages
from typing import Tuple,List
import tempfile
from typing import Optional


def current_time():
    return datetime.datetime.now().strftime("%B %d, %Y %I:%M:%S %p")


load_dotenv()

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)

BASE_DIRECTORY = os.getenv("BASE_DIRECTORY")
if not BASE_DIRECTORY:
    raise ValueError("The environment variable 'BASE_DIRECTORY' is not set.")
BASE_DIR = Path(BASE_DIRECTORY)

# Regex pattern for valid verse file formats (ignores extension)
VALID_VERSE_PATTERN = re.compile(r"^\d+_\d+(?:_\d+)?(?:_default)?$")
# Load API Token from .env
API_TOKEN = os.getenv("API_TOKEN", "api_token")
BASE_URL = os.getenv("BASE_URL", "base ai url")


# Directory for extracted files
UPLOAD_DIR = "Input"
os.makedirs(UPLOAD_DIR, exist_ok=True)



def get_user(db: Session, user_id: int):
    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


def get_project(project_id: int, db: Session, current_user: User):
    """
    Retrieve a project by ID and ensure the user has access to it.

    """
    project = db.query(Project).filter(
        Project.owner_id == current_user.user_id, Project.project_id == project_id
    ).first()

    if not project:
        raise HTTPException(status_code=404, detail="Project not found for the user")
    
    return project



def get_book(db,project_id,book):
    # Fetch the book associated with the project and book_code
    book = (
        db.query(Book)
        .filter(Book.project_id == project_id, Book.book == book)
        .first()
    )
    if not book:
        raise HTTPException(status_code=404, detail="Book not found for the project.")
    return book


def get_chapter(db,book_id,chapter):
    # Fetch the chapter associated with the book and chapter_number
    chapter = (
        db.query(Chapter)
        .filter( Chapter.book_id == book_id, Chapter.chapter == chapter )
        .first()
    )
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found for the book.")
    return chapter


def get_verses(db,chapter_id):
    verses = db.query(Verse).filter(Verse.chapter_id == chapter_id).all()
    if not verses:
        raise HTTPException(status_code=404, detail="No verses found for the chapter")
    return verses


def get_script_lang(db: Session, project_id: int, current_user: User):
    """
    Retrieve the script language of a project.
    """
    project = get_project(project_id, db, current_user)  # ✅ Corrected parameter order
    script_lang = project.script_lang
    if not script_lang:
        raise HTTPException(
            status_code=400, 
            detail="Script language is not defined for the project."
        )
    return script_lang



async def process_uploaded_zip(file: UploadFile) -> Path:
    """
    Validate, save, and extract a ZIP file to a temporary directory.

    """
    # Validate ZIP file format
    if not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Uploaded file is not a ZIP file")
    # Save ZIP file to a temporary location
    temp_zip_path = BASE_DIR / "temp" / file.filename.replace(" ", "_")
    temp_zip_path.parent.mkdir(parents=True, exist_ok=True)
    with open(temp_zip_path, "wb") as buffer:
        buffer.write(await file.read())
    # Extract the ZIP file
    temp_extract_path = BASE_DIR / "temp" / "extracted"
    temp_extract_path.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(temp_zip_path, "r") as zip_ref:
        zip_ref.extractall(temp_extract_path)
    # Remove ZIP file after extraction
    os.remove(temp_zip_path)
    return temp_extract_path




def read_metadata(temp_extract_path: Path) -> dict:
    """Find and read metadata.json."""
    metadata_path = next(temp_extract_path.rglob("metadata.json"), None)
    if not metadata_path:
        raise HTTPException(
            status_code=400, detail="Please upload Scribe's - Scripture Burrito validated zip file"
        )

    with open(metadata_path, "r", encoding="utf-8") as metadata_file:
        return json.load(metadata_file)


def generate_unique_project_name(metadata_content: dict, db: Session) -> str:
    """Generate a unique project name to avoid duplicates."""
    base_name = metadata_content.get("identification", {}).get("name", {}).get("en", "Unknown Project")
    existing_projects = db.query(Project).filter(Project.name.like(f"{base_name}%")).all()

    if existing_projects:
        count = 1
        similar_names = [proj.name for proj in existing_projects]
        while f"{base_name}({count})" in similar_names:
            count += 1
        return f"{base_name}({count})"
    return base_name


def create_project_entry(project_name: str, current_user: dict, db: Session) -> Project:
    """Insert the project into the database and return the created project."""
    project = Project(
        name=project_name,
        owner_id=current_user.user_id,
        script_lang="",
        audio_lang="",
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


def create_project_folders(project: Project, metadata_content: dict) -> Tuple[Path, Path]:
    """Create input and output folders for the project."""
    base_name = metadata_content.get("identification", {}).get("name", {}).get("en", "Unknown Project")
    project_base_path = BASE_DIR / str(project.project_id)
    input_path = project_base_path / "input" / base_name
    output_path = project_base_path / "output" / base_name

    input_path.mkdir(parents=True, exist_ok=True)
    output_path.mkdir(parents=True, exist_ok=True)
    return input_path, output_path


def move_extracted_files(temp_extract_path: Path, input_path: Path):
    """Move extracted files to the input folder."""
    for item in temp_extract_path.iterdir():
        shutil.move(str(item), str(input_path))
    shutil.rmtree(temp_extract_path)

def load_metadata():
    METADATA_FILE = "metadatainfo.json"
    try:
        with open(METADATA_FILE, "r", encoding="utf-8") as file:
            return json.load(file)
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="Metadata file not found.")
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Invalid metadata JSON format.")


def load_versification():
    versification_path = "versification.json"
    try:
        with open(versification_path, "r", encoding="utf-8") as versification_file:
            return json.load(versification_file)
    except FileNotFoundError:
        raise HTTPException(status_code=400, detail="versification.json not found.")
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Invalid versification JSON format.")



def get_project_response(db: Session, project: Project) -> dict:
    """
    Generate a structured response for a project, including associated books and chapters.
    """
    owner = db.query(User).filter(User.user_id == project.owner_id).first()
    books = db.query(Book).filter(Book.project_id == project.project_id).all()

    return {
        "project_id": project.project_id,
        "name": project.name,
        "owner_id": project.owner_id,
        "user_name": owner.username if owner else None,
        "script_lang": project.script_lang,
        "audio_lang": project.audio_lang,
        "archive": project.archive,
        "books": [
            {
                "book_id": book.book_id,
                "book": book.book,
                "approved": check_book_approval(db, book),
                "chapters": get_chapters_for_book(db, book.book_id),
            }
            for book in books
        ],
    }


def fetch_projects_for_role(db: Session, current_user: User, project_id: Optional[int]  = None):
    """
    Fetch projects based on the user's role:
    - Admin/AI: Get all projects (or a specific project if project_id is provided).
    - User: Get only their own projects.
    """
    query = db.query(Project)
    if current_user.role == "User":
        query = query.filter(Project.owner_id == current_user.user_id)

    if project_id:
        project = query.filter(Project.project_id == project_id).first()
        if not project:
            raise HTTPException(
                status_code=404,
                detail="Project not found." if current_user.role in ["Admin", "AI"] else "Project not found for the user.",
            )
        return [project]

    projects = query.all()
    if not projects:
        raise HTTPException(
            status_code=404,
            detail="No projects found." if current_user.role in ["Admin", "AI"] else "No projects found for the user.",
        )
    return projects




def check_book_approval(db: Session, book: Book) -> bool:
    """
    Check if all chapters in a book are approved.
    """
    chapters = db.query(Chapter).filter(Chapter.book_id == book.book_id).all()
    return bool(chapters) and all(chapter.approved for chapter in chapters)



def get_chapters_for_book(db: Session, book_id: int) -> list:
    """
    Fetch chapters for a given book.
    """
    return [
        {
            "chapter_id": chapter.chapter_id,
            "chapter": chapter.chapter,
            "approved": chapter.approved,
            "missing_verses": chapter.missing_verses,
        }
        for chapter in db.query(Chapter).filter(Chapter.book_id == book_id).all()
    ]


def get_project_summary(db: Session, project: Project, current_user: User) -> dict:
    """
    Generate a project summary response including associated books and approval status.
    """
    owner = db.query(User).filter(User.user_id == project.owner_id).first()
    books = db.query(Book).filter(Book.project_id == project.project_id).all()
    return {
        "project_id": project.project_id,
        "name": project.name,
        "script_lang": project.script_lang,
        "audio_lang": project.audio_lang,
        "owner_id": project.owner_id,
        "user_name": owner.username if owner else current_user.username,
        "archive": project.archive,
        "created_date": project.created_date,
        "books": [get_book_summary(db, book) for book in books],
    }


def get_book_summary(db: Session, book: Book) -> dict:
    """
    Generate a summary response for a book including approval status.
    """
    return {
        "book_id": book.book_id,
        "book": book.book,
        "approved": check_book_approval(db, book),
    }





def get_verse_statuses(db: Session, chapter_id: int):
    """
    Retrieve the status of all verses in a chapter.

    Args:
        db (Session): Database session
        chapter_id (int): The ID of the chapter

    Returns:
        list[dict]: List of dictionaries containing verse status information
    """
    verses = get_verses(db, chapter_id)
    
    return [
        {
            "verse_id": verse.verse_id,
            "verse_number": verse.verse,
            "stt": verse.stt,
            "stt_msg": verse.stt_msg,
            "text": verse.text,
            "tts": verse.tts,
            "tts_path": verse.tts_path,
            "modified": verse.modified,
            "size": verse.size,
            "format": verse.format,
            "path": verse.path,
            "name": verse.name,
            "tts_msg": verse.tts_msg,
        }
        for verse in verses
    ]


def normalize_project_structure(input_path):
    """
    Normalize the project directory structure within input_path.
    """
    extracted_items = list(input_path.iterdir())
    if len(extracted_items) == 1 and extracted_items[0].is_dir():
        project_input_path = extracted_items[0]
        next_folder = extracted_items[0]
        
        if next_folder.name == input_path.name:
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
            if re.match(r".+\(\d+\)$", project_input_path.name) or any(char.isalpha() for char in project_input_path.name):
                logger.info(f"Flattening top-level count folder: {project_input_path}")
                for sub_item in project_input_path.iterdir():
                    target_path = input_path / sub_item.name
                    if target_path.exists():
                        logger.warning(f"Conflict while moving {sub_item} to {target_path}, skipping.")
                    else:
                        shutil.move(str(sub_item), str(target_path))
                        logger.info(f"Moved {sub_item} to {target_path}")
                project_input_path.rmdir()
                logger.info(f"Removed count folder: {project_input_path}")
                project_input_path = input_path  
    
    elif any((input_path / item).exists() for item in ["audio", "text-1", "metadata.json"]):
        project_input_path = input_path
    else:
        logger.error("Unexpected folder structure in the input path.")
        raise HTTPException(status_code=400, detail="Please upload Scribe's - Scripture Burrito validated zip file")
    
    if not project_input_path or not project_input_path.is_dir():
        logger.error("Project directory not found under input path.")
        raise HTTPException(status_code=400, detail="Please upload Scribe's - Scripture Burrito validated zip file")
    
    return project_input_path

def locate_versification_and_ingredients(project_input_path):
    """
    Locate versification.json and the ingredients folder.
    """
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
    return max_verses, ingredients_path



def process_books_and_verses(ingredients_path, max_verses, db, project):
    """
    Process books, chapters, and verses from the ingredients folder and populate the database.
    """
    incompartible_verses = []
    has_valid_books = False
    
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
        project_base_path = BASE_DIR / str(project.project_id)
        if project_base_path.exists():
            shutil.rmtree(project_base_path)
            logger.info(f"Deleted project folder: {project_base_path}")
        raise HTTPException(status_code=400, detail="No valid books or chapters found in the project")
    

    return {"status": "success", "incompartible_verses": incompartible_verses}


def process_project_files(input_path, output_path, db, project):
    """
    Process the files in the extracted project directory and populate the database.
    """
    try:
        project_input_path = normalize_project_structure(input_path)
        max_verses, ingredients_path = locate_versification_and_ingredients(project_input_path)
        return process_books_and_verses(ingredients_path, max_verses, db, project)
    
    except HTTPException as http_exc:
        raise http_exc
    except Exception as e:
        logger.error(f"Error while processing project files: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))





def process_verse_files(chapter_dir, chapter_number):
    """
    Process verse files: validate filenames, determine priority, and remove duplicates.
    """
    verse_files = {}
    incompartible_verses = []

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

    return verse_files, incompartible_verses

def setup_project_folders(project, book_entry):
    """
    Set up the necessary project folders for storing book data.
    """
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
    return  target_book_path 


def add_verses_to_db(target_chapter_path, chapter_entry, db):
    """
    Add verses to the database from the processed chapter files.
    """
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

    db.commit()


def process_chapters(book_folder, project, book_entry, db,book_name):
    """
    Process chapters: add new chapters and skip existing ones.
    """
    target_book_path = setup_project_folders(project, book_entry)   
    # Fetch existing chapters
    existing_chapters = {
        chapter.chapter for chapter in db.query(Chapter).filter(Chapter.book_id == book_entry.book_id)
    }
    versification_data = load_versification()
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
            # Call the separate function to process verses and remove duplicates
            verse_files, incompartible_verses = process_verse_files(chapter_dir, chapter_number) 
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
            add_verses_to_db(target_chapter_path, chapter_entry, db)
 
    # If no chapters were added or skipped, raise an error   
    if(not added_chapters and not skipped_chapters):
        raise HTTPException(
            status_code=400,
            detail=f"No verse data found. Please upload valid ZIP file",
        ) 
    db.commit()
    return added_chapters, skipped_chapters, incompartible_verses




async def extract_and_validate_zip(file: UploadFile):
    """
    Extracts and validates the structure of a ZIP file.

    Returns:
        dict: {
            "temp_extract_path": Path,
            "book_folder": Path
        }
    """
    temp_zip_path = BASE_DIR / "temp" / file.filename.replace(" ", "_")
    temp_extract_path = BASE_DIR / "temp" / "extracted_book"
    logger.debug(f"Temp ZIP path: {temp_zip_path}")
    logger.debug(f"Temp extract path: {temp_extract_path}")
    try:
        # Create temporary directories
        temp_zip_path.parent.mkdir(parents=True, exist_ok=True)
        temp_extract_path.mkdir(parents=True, exist_ok=True)
        logger.debug("Temporary directories created.")

        # Save the uploaded ZIP file
        with open(temp_zip_path, "wb") as buffer:
            buffer.write(await file.read())
            logger.debug(f"Saved uploaded file to {temp_zip_path}")


        # Extract the ZIP file
        try:
            with zipfile.ZipFile(temp_zip_path, "r") as zip_ref:
                logger.debug(f"ZIP file content: {zip_ref.namelist()}")
                zip_ref.extractall(temp_extract_path)
                logger.debug(f"ZIP file extracted to {temp_extract_path}")
        except zipfile.BadZipFile:
            raise HTTPException(status_code=400, detail="The file is not a valid ZIP archive")

        # Remove the ZIP file after extraction
        temp_zip_path.unlink()
        logger.debug(f"Deleted temporary ZIP file: {temp_zip_path}")

        # Verify and normalize the extracted structure
        extracted_items = list(temp_extract_path.iterdir())
        logger.debug(f"Extracted items in root: {[item.name for item in extracted_items]}")

        for item in extracted_items:
            logger.debug(f"{item.name} - is_dir: {item.is_dir()}")
        # Case 1: Direct single chapter folder in the ZIP root
        if len(extracted_items) == 1 and extracted_items[0].is_dir() and extracted_items[0].name.isdigit():       
            logger.info(f"Detected single chapter folder directly in ZIP root: {extracted_items[0]}")
            book_folder = temp_extract_path
        
        # Case 2: Single folder encapsulating everything
        elif len(extracted_items) == 1 and extracted_items[0].is_dir():       
            primary_folder = extracted_items[0]
            inner_items = list(primary_folder.iterdir())
            logger.debug(f"Primary folder name: {primary_folder.name}")
            logger.debug(f"Primary folder contents: {[item.name for item in inner_items]}")
            for inner_item in inner_items:
                logger.debug(f"{inner_item.name} - is_dir: {inner_item.is_dir()}")

            if all(item.is_dir() and item.name.isdigit() for item in inner_items):
                # Encapsulating folder directly contains chapter folders
                logger.info(f"Detected encapsulating folder with chapters: {primary_folder}")
                book_folder = primary_folder
            elif len(inner_items) == 1 and inner_items[0].is_dir() and inner_items[0].name.isdigit():
                # Encapsulating folder contains a single chapter folder
                logger.info(f"Detected single chapter folder inside book folder: {inner_items[0]}")
                book_folder = primary_folder
            else:
                logger.error("Unexpected structure inside primary folder.")
                raise HTTPException(status_code=400, detail="Invalid book folder structure")
        
        # Case: Multiple chapter folders in the root of the ZIP
        elif all(item.is_dir() and item.name.isdigit() for item in extracted_items):       
            logger.info("Detected multiple chapter folders directly in the ZIP root.")
            book_folder = temp_extract_path
        else:
            logger.error("Unexpected structure in the extracted ZIP file.")
            raise HTTPException(status_code=400, detail="Invalid book folder structure")
        
        logger.debug(f"Book folder resolved: {book_folder}")
        return {
            "temp_extract_path": temp_extract_path,
            "book_folder": book_folder
        }

    except HTTPException:
        # Clean up before re-raising known HTTP errors
        logger.debug(f"Cleaning up temp path due to HTTPException: {temp_extract_path}")
        shutil.rmtree(temp_extract_path, ignore_errors=True)
        raise

    except Exception as e:
        logger.error(f"Unexpected error during ZIP processing: {e}")
        shutil.rmtree(temp_extract_path, ignore_errors=True)
        raise HTTPException(status_code=500, detail="An unexpected error occurred while extracting the ZIP file.")

async def process_book_zip(project_id: int, file: UploadFile, db: Session, current_user: dict):
    """
    Process the uploaded ZIP file: Extract, validate, and return paths.
    """
    # Check if the project exists
    project = get_project(project_id, db, current_user)
    versification_data = load_versification()
    valid_books = set(versification_data.get("maxVerses", {}).keys())
    # Extract book name from the file
    book = file.filename.rsplit(".", 1)[0]
    # Validate book name
    if book not in valid_books:
        raise HTTPException(status_code=400, detail=f"Invalid book: {book}")
    # Ensure the uploaded file is a ZIP file
    if not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Uploaded file is not a ZIP file")
    # Extract and validate ZIP file structure
    zip_data = await extract_and_validate_zip(file)
    
    return {
    "book": book,
    "temp_extract_path":zip_data["temp_extract_path"],
    "book_folder":  zip_data["book_folder"],
    "project": project,
    "versification_data": versification_data
}



def save_book_to_project(
    project: Project,
    book: str,
    book_folder: Path,
    temp_extract_path: Path,
    versification_data: dict,
    db: Session,
):
    """
    Save the book to the project: Move files, validate, and store in DB.
    """
    # Check if the book already exists in the project
    existing_book = (
        db.query(Book)
        .filter(Book.project_id == project.project_id, Book.book == book)
        .first()
    )
    if existing_book:
        # Perform chapter-level checks for the existing book
        added_chapters, skipped_chapters, incompartible_verses = process_chapters(book_folder, project, existing_book, db,book)
        shutil.rmtree(temp_extract_path, ignore_errors=True)
        return {
            "message": "Book already exists. Additional chapters processed.",
            "book": book,
            "added_chapters": added_chapters,
            "skipped_chapters": skipped_chapters,
            "incompartible_verses": incompartible_verses
        }
    else:
        # Add a new book and process chapters
        book_entry = Book(
            project_id=project.project_id,
            book=book,
        )
        db.add(book_entry)
        db.commit()
        db.refresh(book_entry)
    # Dynamically locate the ingredients folder
    base_name = project.name.split("(")[0].strip()
    project_root_path = BASE_DIR / str(project.project_id) / "input" / base_name   
    ingredients_path = None
    # Check for ingredients folder in root or audio
    if (project_root_path / "ingredients").exists():
        ingredients_path = project_root_path / "ingredients"
    elif (project_root_path / "audio" / "ingredients").exists():
        ingredients_path = project_root_path / "audio" / "ingredients"
    else:
        # Create ingredients path if not present
        ingredients_path = project_root_path / "ingredients"
        ingredients_path.mkdir(parents=True, exist_ok=True)
    # Move the book folder into the ingredients folder
    target_book_path = ingredients_path / book
    if target_book_path.exists():
        shutil.rmtree(temp_extract_path, ignore_errors=True)
        raise HTTPException(status_code=400, detail="Book folder already exists in ingredients")
    shutil.move(str(book_folder), str(target_book_path)) 
    max_verses_data = versification_data.get("maxVerses", {})   
    # Get maximum chapters for the book
    max_chapters = len(max_verses_data[book])
    book_max_verses = max_verses_data.get(book, [])  
    # Initialize has_valid_chapters to track valid chapters
    has_valid_chapters = False   
    incompartible_verses = []
    # Filter out invalid chapters first
    for chapter_dir in target_book_path.iterdir():
        if chapter_dir.is_dir() and chapter_dir.name.isdigit():
            chapter_number = int(chapter_dir.name)
            if chapter_number > max_chapters:
                logger.error(f"Invalid chapter {chapter_number}: Exceeds maximum allowed chapters ({max_chapters})")
                shutil.rmtree(target_book_path, ignore_errors=True)
                db.delete(book_entry)
                db.commit()
                raise HTTPException(
                    status_code=400,
                    detail=f"{book} should have {max_chapters} chapter(s) but found chapter {chapter_number}. "
                        "Please upload the ZIP file with proper chapter count"
                )               
            chapter_max_verses = (
                int(book_max_verses[chapter_number - 1])
                if chapter_number <= len(book_max_verses)
                else 0
            )
            # Get all available verses in the chapter
            available_verses = set(
                int(verse_digits.group(1))
                for verse_file in chapter_dir.iterdir()
                if verse_file.is_file() and "_" in verse_file.stem
                for verse_digits in [re.match(r"^(\d+)", verse_file.stem.split("_")[1])]
                if verse_digits
            )           
            print(f"available verses in chapter {chapter_number}", available_verses)
            # If no verses are found, delete the empty chapter folder
            if not available_verses:
                logger.info(f"Empty chapter detected: {chapter_dir}, deleting it.")
                shutil.rmtree(chapter_dir)
                continue           
            # Validate verses
            if available_verses and max(available_verses) > chapter_max_verses:
                logger.error(
                    f"{book}: Chapter {chapter_number} should have {chapter_max_verses} verses "
                    f"but {max(available_verses)} verses found"
                )
                # Clean up and raise immediate error
                shutil.rmtree(target_book_path, ignore_errors=True)
                db.delete(book_entry)
                db.commit()
                raise HTTPException(
                    status_code=400,
                    detail=f"{book}: Chapter {chapter_number} has only {chapter_max_verses} verses "
                        f"but {max(available_verses)} verses found. "
                        "Please upload the ZIP file with correct verse count."
                )               
    # Process the book structure (chapters and verses)
    for chapter_dir in target_book_path.iterdir():
        if chapter_dir.is_dir() and chapter_dir.name.isdigit():
            chapter_number = int(chapter_dir.name)           
            chapter_max_verses = (
                int(book_max_verses[chapter_number - 1])
                if chapter_number <= len(book_max_verses)
                else 0
            )
            # Process verses, tracking and removing duplicates
            verse_files, incompartible_verses = process_verse_files(chapter_dir, chapter_number)
            # Finalize verse files after prioritization
            selected_files = {verse: data['file'] for verse, data in verse_files.items()}         
            # Get available verses after duplicate removal
            available_verses = set(selected_files.keys())
            # Determine missing verses
            expected_verses = set(range(1, chapter_max_verses + 1))
            missing_verses = list(expected_verses - available_verses)
            # Create chapter entry in the database
            chapter_entry = Chapter(
                book_id=book_entry.book_id,
                chapter=chapter_number,
                approved=False,
                missing_verses=missing_verses if missing_verses else None,
            )
            db.add(chapter_entry)
            db.commit()
            db.refresh(chapter_entry)
            has_valid_chapters = True
            # Add verse records
            for verse_number, verse_file in selected_files.items():
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
    # After processing all chapters, check if there were any valid chapters
    if not has_valid_chapters:
        logger.error(f"No valid chapters with verses found for book: {book}. Removing the book folder.")
        shutil.rmtree(target_book_path, ignore_errors=True)
        db.delete(book_entry)
        db.commit()
        raise HTTPException(
            status_code=400,
            detail=f"No verse data found in book: {book}",
        )
    db.commit()
    # Clean up the temporary extraction folder
    if temp_extract_path:
        shutil.rmtree(temp_extract_path, ignore_errors=True)
    return {"message": "Book added successfully", "book_id": book_entry.book_id, "book": book, "incompartible_verses": incompartible_verses}
def get_chapter_book_project(db: Session, chapter_id: int, current_user: User):
    """
    Fetch the chapter, associated book, and project.
    Ensures the user has access to the project.
    """
    chapter = db.query(Chapter).filter(Chapter.chapter_id == chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found.")
    book = db.query(Book).filter(Book.book_id == chapter.book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found.")
    project = db.query(Project).filter(Project.project_id == book.project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")
    if project.owner_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="You do not have access to this project.")
    return chapter, book, project



def get_modified_verses(db: Session, chapter_id: int) -> list:
    """
    Fetch all modified verses for the given chapter.
    """
    return db.query(Verse).filter(Verse.chapter_id == chapter_id, Verse.modified == True).all()




def get_output_format(verses: list) -> str:
    """
    Determine the output file format from the first verse in the chapter.
    """
    if verses and verses[0].path:
        return verses[0].path.split(".")[-1]
    raise HTTPException(
        status_code=400,
        detail="Unable to determine the output format from the verse path.",
    )



def validate_tts_model(audio_lang: str):
    """
    Check if the TTS model is available for the given language.
    """
    if not is_model_served(audio_lang, "tts"):
        raise HTTPException(
            status_code=400,
            detail="The TTS model is not currently available for this language."
        )

def test_stt_api(file_paths: List[str], script_lang: str):
    """
    Test the STT API with one file before processing all files.

    Args:
        file_paths (List[str]): List of file paths to transcribe.
        script_lang (str): The script language for transcription.

    Raises:
        HTTPException: If no valid files are found or the STT API fails.

    Returns:
        None: If the test is successful, the function completes silently.
    """
    if not file_paths:
        raise HTTPException(status_code=400, detail="No valid audio files found for transcription.")
    
    test_file = file_paths[0]  # Pick the first file for testing
    logger.info(f"[{current_time()}] Testing transcription API with file: {test_file}")
    
    test_result = call_stt_api(test_file, script_lang)

    if "data" not in test_result or "jobId" not in test_result["data"]:
        logger.error(f"STT API test failed: {test_result}")
        raise HTTPException(
            status_code=500,
            detail="STT API failed during testing. Not proceeding with transcription."
        )

    logger.info(f"[{current_time()}] STT API test successful. Proceeding with transcription.")





def test_tts_api(verses: list, audio_lang: str, output_format: str):
    """
    Test the TTS API with one verse before proceeding with background processing.
    """
    test_verse = verses[0]  # Pick the first verse for testing
    logger.info(f"[{current_time()}] Testing TTS API with verse ID {test_verse.verse_id}")
    test_result = call_tts_api([test_verse.text], audio_lang, output_format)
    if "data" not in test_result or "jobId" not in test_result["data"]:
        logger.error(f"TTS API test failed: {test_result}")
        raise HTTPException(status_code=500, detail="TTS API failed during testing. Not proceeding with speech conversion.")
    logger.info(f"[{current_time()}] ✅ TTS API test successful. Proceeding with speech conversion.")



def transcribe_verses(file_paths: list[str], script_lang: str, db_session: Session):
    """
    Background task to transcribe verses with simplified concurrent processing.
    """
    chapter_start_time = time.time()
    logger.info(f"[{chapter_start_time}] 🟢 Transcription process started for chapter at OBT Backend")   
    # Dictionary to store active jobs
    active_jobs = {}  # Format: {ai_jobid: (verse, job, file_path)}  
    try:
        # Step 1: Submit all transcription jobs first
        for file_path in file_paths:
            
            verse = db_session.query(Verse).filter(Verse.path == file_path).first()
            if not verse:
                logger.error(f"Verse file not found for path: {file_path}")
                continue
            
            # Skip if already transcribed successfully
            if verse.stt_msg == "Transcription successful":
                logger.info(f"Skipping transcription for verse {verse.verse_id}: Already transcribed.")
                continue        
            # Reset verse status if needed
            if verse.stt_msg != "Transcription successful":
                logger.info(f"Resetting stt_msg for verse {verse.verse_id}.")
                verse.stt_msg = ""
                verse.stt = False  # Resetting stt flag as well
                db_session.add(verse)
                db_session.commit()  # Save the updates before calling STT API
                
                # Create and save job
                job = Job(verse_id=verse.verse_id, ai_jobid=None, status="pending")
                db_session.add(job)
                db_session.commit()               
                # Submit to STT API
                result = call_stt_api(file_path, script_lang)               
                if "error" in result:
                    job.status = "failed"
                    verse.stt = False
                    verse.stt_msg = result.get("error", "Unknown error")
                    logger.error(f"[{router.current_time()}] STT API error: {result.get('error', 'Unknown error')}")
                    db_session.add(job)
                    db_session.add(verse)
                    db_session.commit()
                else:
                    ai_jobid = result.get("data", {}).get("jobId")
                    job.ai_jobid = ai_jobid
                    job.status = "in_progress"
                    active_jobs[ai_jobid] = (verse, job, file_path)
                    db_session.add(job)
                    db_session.commit()
                    logger.info(f"[{router.current_time()}] 🔄 STT AI Job ID {ai_jobid} received. Monitoring job status...")
        
        # Step 2: Monitor all jobs until completion
        while active_jobs:
            jobs_to_remove = []  # Store jobs to remove after iteration
            
            # Check status for all active jobs
            for ai_jobid, (verse, job, file_path) in active_jobs.items():
                result = check_ai_job_status(ai_jobid)
                job_status = result.get("data", {}).get("status")
                logger.info(f"[{router.current_time()}] ⏳ AI Job {ai_jobid} Status: {job_status}")
                
                if job_status == "job finished":
                    
                    # Process successful transcription
                    transcription = result["data"]["output"]["transcriptions"][0]
                    transcription_time = result["data"]["output"]["transcription_time"]

                    audio_file = transcription["audioFile"]
                    logger.info(f"[{router.current_time()}] 🎉 Verse id {verse.verse_id}, audio file {audio_file} finished in {transcription_time} seconds.")
                    transcribed_text = transcription["transcribedText"]
                    
                    verse.text = transcribed_text
                    verse.stt = True
                    verse.stt_msg = "Transcription successful"
                    job.status = "completed"
                    
                    # Update database immediately
                    db_session.add(verse)
                    db_session.add(job)
                    db_session.commit()
                    
                    jobs_to_remove.append(ai_jobid)
                    
                
                elif job_status in ["job failed", "Error"]:
                    job.status = "failed"
                    verse.stt = False
                    verse.stt_msg = "AI transcription failed"
                    
                    # Update database immediately
                    db_session.add(verse)
                    db_session.add(job)
                    db_session.commit()
                    
                    jobs_to_remove.append(ai_jobid)
                    logger.error(f"[{router.current_time()}] AI Transcription failed for Job ID {ai_jobid}.")
            
            # Remove completed jobs from tracking
            for ai_jobid in jobs_to_remove:
                active_jobs.pop(ai_jobid)
            
            # Wait before next check if there are still active jobs
            if active_jobs:
                time.sleep(5)
    
    except Exception as e:
        logger.error(f"Error in transcribe_verses: {str(e)}")
    
    finally:
        db_session.close()
        chapter_end_time = time.time()
        logger.info(f"[{router.current_time()}] 🕒 Transcription process for chapter completed in {chapter_end_time - chapter_start_time:.2f} seconds at OBT Backend")


def check_ai_job_status(ai_jobid: str) -> dict:
    """
    Check the status of an AI transcription job.
    """
    job_status_url =  f"{BASE_URL}/model/job?job_id={ai_jobid}"
    headers = {"Authorization": f"Bearer {API_TOKEN}"}
    try:
        response = requests.get(job_status_url, headers=headers, timeout=120) #it will wait 120 seconds for response

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


def is_model_served(lang: str, model_type: str) -> bool:
    """
    Check if the STT or TTS model is currently available for the given language.

    Args:
        lang (str): The spoken language to check.
        model_type (str): Either "stt" for Speech-to-Text or "tts" for Text-to-Speech.

    Returns:
        bool: True if the model is available, False otherwise.
    """
    SERVED_MODELS_URL = f"{BASE_URL}/model/served-models"
    logger.info(f"Checking if {model_type.upper()} model is served for language: {lang}")

    try:
        headers = {"Authorization": f"Bearer {API_TOKEN}"}
        response = requests.get(SERVED_MODELS_URL, headers=headers, timeout=60) #it will wait 60 seconds for response
        if response.status_code != 200:
            logger.error(f" Error fetching served models: {response.status_code} - {response.text}")
            raise HTTPException(status_code=500, detail="Failed to fetch served models")
        
        served_models = response.json()
        served_model_names = {model["modelName"] for model in served_models}
        logger.info(f" Available models: {served_model_names}")

        # Determine the correct source language
        source_language = next(
            (entry["script_language"] for entry in source_languages if entry["language_name"] == lang),
            lang  # Default to original language if no mapping is found
        )
        logger.info(f"Mapped '{lang}' to source language '{source_language}'")

        # Fetch the correct model mapping (STT/TTS)
        model_mapping = language_codes.get(source_language, {}).get(model_type, {})

        if not model_mapping:
            logger.error(f"❌ No {model_type.upper()} model found for language: {source_language}")
            return False

        # Check if any mapped model is served
        for model_name in model_mapping.keys():
            if model_name in served_model_names:
                logger.info(f"✅ Model '{model_name}' is available for {model_type.upper()}.")
                return True

        logger.warning(f"⚠ No matching {model_type.upper()} model found in served models for '{source_language}'.")
        raise HTTPException(
            status_code=400,
            detail=f"The {model_type.upper()} model is not currently available for this language: {source_language}"
        )

    except requests.exceptions.RequestException as e:
        logger.error(f"❌ Request error checking served models: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to check served models")


def fetch_and_validate_verse(verse_id: int, db: Session, current_user: User) -> dict:
    """
    Fetch the verse and validate the associated chapter, book, and project.
    Ensures the user has the necessary permissions.

    Returns:
        dict: Contains 'verse', 'chapter', 'book', and 'project' objects.
    """
    verse_record = db.query(Verse).filter(Verse.verse_id == verse_id).first()
    if not verse_record:
        raise HTTPException(status_code=404, detail="Verse not found.")

    chapter = db.query(Chapter).filter(Chapter.chapter_id == verse_record.chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found for the verse.")

    book = db.query(Book).filter(Book.book_id == chapter.book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found for the chapter.")

    project = db.query(Project).filter(Project.project_id == book.project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found for the book.")

    # Validate the user is the owner of the project
    if project.owner_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="You do not have access to this project.")

    return {
        "verse": verse_record,
        "chapter": chapter,
        "book": book,
        "project": project,
    }


def update_verse_content(verse: Verse, verse_text: str):
    """
    Updates the verse text, marks it as modified, and resets TTS if applicable.
    """
    verse.text = verse_text
    verse.modified = True

    # Reset TTS-related fields if TTS was previously generated
    if verse.tts:
        delete_tts_file(verse.tts_path)
        verse.tts = False
        verse.tts_msg = ""
        verse.tts_path = ""


def delete_tts_file(tts_path: str):
    """
    Deletes the existing TTS file if it exists.
    """
    if tts_path and os.path.exists(tts_path):
        try:
            os.remove(tts_path)
            logger.info(f"Deleted TTS file at path: {tts_path}")
        except Exception as e:
            logger.warning(f"Failed to delete TTS file at path {tts_path}: {str(e)}")


def mark_chapter_unapproved(chapter: Chapter, db: Session):
    """
    Marks the chapter as not approved and updates the database.
    """
    chapter.approved = False
    db.add(chapter)




def call_stt_api(file_path: str, script_lang: str) -> dict:
    """
     Calls the AI API to transcribe the given audio file.
    """
    
    # AI API Base URL (model_name will be dynamic)
    TRANSCRIBE_API_URL = f"{BASE_URL}/model/audio/transcribe"
    device_type = os.getenv("STT_DEVICE", "cpu")
 
    # Get the model_name and language_code dynamically
    try:
        stt_mapping = language_codes.get(script_lang, {}).get("stt", {})
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
 
    # Prepare API URL
    ai_api_url = f"{TRANSCRIBE_API_URL}?model_name={model_name}&device={device_type}"
    file_name = os.path.basename(file_path)
    try:
        with open(file_path, "rb") as audio_file:
            files_payload = {"files": (file_name, audio_file, "audio/wav")}
            data_payload = {"transcription_language": lang_code}
            headers = {"Authorization": f"Bearer {API_TOKEN}"}

            # Send batch request
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
    start_time = time.time()
    logger.info(f"[{router.current_time()}] 🟢 TTS conversion started at OBT Backend")
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
                logger.info(f"Resetting tts_msg for verse {verse.verse_id}.")
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
                logger.info(f"[{router.current_time()}]  Calling TTS AI API for Verse ID {verse.verse_id}")
                ai_api_start_time = time.time()
                result = call_tts_api([verse.text], audio_lang,output_format)
                
                if "error" in result:
                    # Handle API error
                    job.status = "failed"
                    verse.tts = False
                    verse.tts_msg = result.get("error", "Unknown error")
                    logger.error(f"[{router.current_time()}]  TTS API error: {result.get('error', 'Unknown error')}")
                else:
                    # Update the job with the AI job ID
                    ai_jobid = result.get("data", {}).get("jobId")
                    job.ai_jobid = ai_jobid
                    job.status = "in_progress"
                    db_session.add(job)
                    db_session.commit()
                    logger.info(f"[{router.current_time()}] 🔄 TTS AI Job ID {ai_jobid} received. Monitoring job status...")
 
                    # Poll AI job status until it's finished
                    while True:
                        job_result = check_ai_job_status(ai_jobid)
                        job_status = job_result.get("data", {}).get("status")
 
                        if job_status == "job finished":
                            ai_api_end_time = time.time()
                            logger.info(f"[{router.current_time()}]  TTS Conversion for verse completed in {ai_api_end_time - ai_api_start_time:.2f} seconds at AI side")
                            # Download and extract the audio ZIP file
                            audio_zip_url = f"{BASE_URL}/assets?job_id={ai_jobid}"
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
                        elif job_status in ["job failed", "Error"]:
                            job.status = "failed"
                            verse.tts = False
                            verse.tts_msg = "AI TTS job failed"
                            logger.error(f"[{router.current_time()}]  TTS AI conversion failed for Job ID {ai_jobid}.")
                            break
                        time.sleep(5)
 
                # Save the updated job and verse statuses
                db_session.add(job)
                db_session.add(verse)
                db_session.commit()
                end_time = time.time()
                logger.info(f"[{router.current_time()}] 🕒 TTS conversion for verse completed in {end_time - start_time:.2f} seconds at OBT Backend")
 
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
    headers = {"Authorization": f"Bearer {API_TOKEN}"}
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

def call_tts_api(text: str, audio_lang: str ,output_format:str) -> dict:
    """
    Call the AI API for text-to-speech.
    """
    
    # AI API Base URL
    TTS_API_URL = f"{BASE_URL}/model/audio/generate"
    # API Token
    api_token = "ory_st_mby05AoClJAHhX9Xlnsg1s0nn6Raybb3"
 
    # Map audio_lang to source_language
    source_language = None
    for item in source_languages:
        if item["language_name"] == audio_lang:
            source_language = item["script_language"]
            break
 
    if not source_language:
        logger.error(f"No source language found for audio_lang: {audio_lang}")
        return {"error": f"No source language found for audio_lang: {audio_lang}"}
 
    # Get the model_name and language_code dynamically
    try:
        tts_mapping = language_codes.get(source_language, {}).get("tts", {})
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
        response = requests.post(TTS_API_URL, params=params, json=data_payload, headers=headers)
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


def fetch_book_metadata(book: str, book_metadata: dict) -> dict:
    """
    Fetch book metadata (short title, abbreviation, and long title).

    Returns:
        dict: Contains short_title, abbr, and long_title.
    """
    if book not in book_metadata:
        raise HTTPException(status_code=404, detail=f"Metadata not found for book {book}.")

    return {
        "short_title": book_metadata[book]["short"]["en"],
        "abbr": book_metadata[book]["abbr"]["en"],
        "long_title": book_metadata[book]["long"]["en"],
    }

def generate_usfm_content(book, book_info, chapter_map, versification_data, db):
    """
    Generate USFM formatted content with book metadata and verses.
    """
    usfm_text = (
        f"\\id {book}\n\\usfm 3.0\n\\ide UTF-8\n"
        f"\\h {book_info['short_title']}\n\\toc1 {book_info['abbr']}\n\\toc2 {book_info['short_title']}\n"
        f"\\toc3 {book_info['long_title']}\n\\mt {book_info['abbr']}\n"
    )

    max_verses = versification_data.get("maxVerses", {}).get(book, [])
    if not max_verses:
        raise HTTPException(
            status_code=404, detail=f"Versification data not found for book '{book}'."
        )
    for chapter_number, num_verses in enumerate(max_verses, start=1):
        try:
            num_verses = int(num_verses)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid verse count '{num_verses}' for chapter {chapter_number} in book '{book}'",
            )

        usfm_text += f"\\c {chapter_number}\n\\p\n"

        if chapter_number in chapter_map:
            chapter = chapter_map[chapter_number]
            verses = db.query(Verse).filter(Verse.chapter_id == chapter.chapter_id).all()
            verse_map = {verse.verse: verse.text for verse in verses}

            for verse_number in range(1, num_verses + 1):
                usfm_text += f"\\v {verse_number} {verse_map.get(verse_number, '...')}\n"
        else:
            for verse_number in range(1, num_verses + 1):
                usfm_text += f"\\v {verse_number} ...\n"

    return usfm_text


def save_and_return_usfm_file(project, book, usfm_text):
    """
    Save the generated USFM content as a file and return it.
    """
    base_name = project.name.split("(")[0].strip()
    project_output_path = BASE_DIR / str(project.project_id) / "output" / base_name / "text-1" / "ingredients"
    os.makedirs(project_output_path, exist_ok=True)

    usfm_file_path = project_output_path / f"{book}.usfm"
    with open(usfm_file_path, "w", encoding="utf-8") as usfm_file:
        usfm_file.write(usfm_text)

    return FileResponse(
        usfm_file_path,
        media_type="text/plain",
        filename=f"{book}.usfm",
    )



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
        logger.info(f"Current sample rate: {sample_rate} Hz")

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



def prepare_project_for_zipping(project: Project):
    """
    Prepare the directory structure and organize project files in a temporary directory before zipping.
    """
    base_name = project.name.split("(")[0].strip()
    base_dir = Path(BASE_DIRECTORY) / str(project.project_id)
    input_dir = base_dir / "input" / base_name
    output_dir = base_dir / "output" / base_name
 
    final_dir = base_dir / project.name
    zip_path = f"{final_dir}.zip"
    # Cleanup logic: Remove existing folders or zip files with the same name
    if final_dir.exists():
        shutil.rmtree(final_dir, ignore_errors=True)
        logger.info(f"Removed existing directory: {final_dir}")
    if os.path.exists(zip_path):
        os.remove(zip_path)
        logger.info(f"Removed existing zip file: {zip_path}")
 
    if not input_dir.exists() or not output_dir.exists():
        raise HTTPException(
            status_code=404, detail=f"Input or output directory not found for project: {project.project_id}."
        )
 
    # Create a temporary directory
    with tempfile.TemporaryDirectory(dir=base_dir) as temp_dir_path:
        temp_dir = Path(temp_dir_path)
        temp_audio_dir = temp_dir / "audio" / "ingredients"
        temp_text_dir = temp_dir / "text-1" / "ingredients"
 
        temp_audio_dir.mkdir(parents=True, exist_ok=True)
        temp_text_dir.mkdir(parents=True, exist_ok=True)
 
        # Step 2: Copy the output folder into the temporary directory
        shutil.copytree(output_dir, temp_dir / "output", dirs_exist_ok=True)
 
        # Step 3: Process audio files
        input_audio_dir = input_dir / "audio" / "ingredients"
        if not input_audio_dir.exists():
            input_audio_dir = input_dir / "ingredients"
 
        for book_dir in input_audio_dir.iterdir():
            if book_dir.is_dir():
                temp_book_dir = temp_audio_dir / book_dir.name
                temp_book_dir.mkdir(parents=True, exist_ok=True)
                for chapter_dir in book_dir.iterdir():
                    if chapter_dir.is_dir():
                        temp_chapter_dir = temp_book_dir / chapter_dir.name
                        temp_chapter_dir.mkdir(parents=True, exist_ok=True)
 
                        output_chapter_dir = (
                            output_dir
                            / "audio"
                            / "ingredients"
                            / book_dir.name
                            / chapter_dir.name
                        )
                        output_files = (
                            {
                                f.stem: f
                                for f in output_chapter_dir.iterdir()
                                if f.is_file()
                            }
                            if output_chapter_dir.exists()
                            else {}
                        )
                        for input_file in chapter_dir.iterdir():
                            if input_file.is_file():
                                # Use the output file if it exists, otherwise retain the input file
                                output_file = output_files.get(input_file.stem)
                                if output_file:
                                    shutil.copy(
                                        output_file, temp_chapter_dir / output_file.name
                                    )
                                else:
                                    shutil.copy(
                                        input_file, temp_chapter_dir / input_file.name
                                    )
        for additional_file in input_audio_dir.iterdir():
            if additional_file.is_file() and additional_file.suffix in {".json", ".md"}:
                # Copy the file to both temp_audio_dir and temp_text_dir
                shutil.copy(additional_file, temp_audio_dir / additional_file.name)
                shutil.copy(additional_file, temp_text_dir / additional_file.name)
 
        # Step 4: Handle text files
        input_text_dir = input_dir / "text-1" / "ingredients"
        output_text_dir = output_dir / "text-1" / "ingredients"
 
        # Step 4.1: By default, copy all USFM files from output directory to the temporary directory
        if output_text_dir.exists():
            for output_file in output_text_dir.iterdir():
                if output_file.suffix == ".usfm" and output_file.is_file():
                    shutil.copy(output_file, temp_text_dir / output_file.name)
 
        if input_text_dir.exists():
            temp_text_files = {
                f.stem: f for f in temp_text_dir.iterdir() if f.is_file()
            }
 
            for input_file in input_text_dir.iterdir():
                if input_file.suffix == ".usfm" and input_file.is_file():
                    # Overwrite or copy files to temporary directory as per conditions
                    if input_file.stem in temp_text_files:
                        # Skip copying, retain the temporary directory's file
                        continue
                    else:
                        # Copy the file from input to the temp directory
                        shutil.copy(input_file, temp_text_dir / input_file.name)
 
        # Step 5: Copy metadata
        metadata_file = input_dir / "metadata.json"
        if metadata_file.exists():
            metadata_text_dir = temp_dir / "text-1"
            metadata_text_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy(metadata_file, temp_dir / "metadata.json")
            shutil.copy(metadata_file, metadata_text_dir / "metadata.json")
 
        # Step 6: Remove unnecessary directories
        shutil.rmtree(temp_dir / "output", ignore_errors=True)
        # Step 7: Rename and zip the directory
        final_dir = base_dir / project.name
        shutil.move(temp_dir, final_dir)

    return final_dir, zip_path


def create_zip_and_return_response(final_dir: Path, zip_path: str, project_name: str):
    """
    Create a ZIP file from the final directory and return it as a response.
    """
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
        for root, _, files in os.walk(final_dir):
            for file in files:
                file_path = Path(root) / file
                arcname = file_path.relative_to(final_dir)
                zipf.write(file_path, arcname)

    return FileResponse(
        zip_path,
        media_type="application/zip",
        filename=f"{project_name}.zip",
    )