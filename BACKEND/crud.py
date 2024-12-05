
from sqlalchemy.orm import Session
import zipfile
import os
from database import SessionLocal,VerseFile,Chapter,Job
import logging
import requests
import time
import shutil


logging.basicConfig(level=logging.DEBUG)


# Directory for extracted files
UPLOAD_DIR = "Input"
os.makedirs(UPLOAD_DIR, exist_ok=True)

def transcribe_verses(file_paths: list[str], db_session: Session):
    """
    Background task to transcribe verses and update the database.
    """
    try:
        for file_path in file_paths:
            # Retrieve the VerseFile entry based on the file path
            verse = db_session.query(VerseFile).filter(VerseFile.path == file_path).first()
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
                result = call_ai_api(file_path)
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





def call_ai_api(file_path: str) -> dict:
    """
    Calls the AI API to transcribe the given audio file.
    """
    ai_api_url = "https://api.vachanengine.org/v2/ai/model/audio/transcribe?model_name=mms-1b-all"
    transcription_language = "hin"
    file_name = os.path.basename(file_path)
    api_token = "ory_st_mby05AoClJAHhX9Xlnsg1s0nn6Raybb3"
    try:
        with open(file_path, "rb") as audio_file:
            files_payload = {"files": (file_name, audio_file, "audio/wav")}
            data_payload = {"transcription_language": transcription_language}
            headers = {"Authorization": f"Bearer {api_token}"}

            # Make the API request
            response = requests.post(ai_api_url, files=files_payload, data=data_payload, headers=headers)
        logging.info(f"AI API Response: {response.status_code} - {response.text}")
        if response.status_code == 201:
            return response.json()  # {"data": {"jobId": "123", "status": "created"}}
        else:
            logging.error(f"AI API Error: {response.status_code} - {response.text}")
            return {"error": "Failed to transcribe", "status_code": response.status_code}
    except Exception as e:
        logging.error(f"Error in call_ai_api: {str(e)}")
        return {"error": "Exception occurred", "details": str(e)}



def generate_speech_for_verses(project_id: int, book_code: str, verses, audio_lang: str, db):
    """
    Generate speech for each verse and update the database.
    """
    db_session = SessionLocal()
    Edited_dir = "Output"
    os.makedirs(Edited_dir, exist_ok=True)
    try:
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
                                book_folder = os.path.join(Edited_dir, book_code)
                                chapter_folder = os.path.join(book_folder, str(chapter.chapter))
                                os.makedirs(chapter_folder, exist_ok=True)
                                # Find and move the audio file to the proper chapter folder
                                for root, _, files in os.walk(extracted_folder):
                                    for file in files:
                                        if file == "audio_0.wav":
                                            # Remove any existing extensions from verse.name and add .wav
                                            base_name = os.path.splitext(verse.name)[0]  # Get the name without extension
                                            new_audio_filename = f"{base_name}.wav"  # Add only the .wav extension
                                            new_audio_path = os.path.join(chapter_folder, new_audio_filename)
                                            shutil.move(os.path.join(root, file), new_audio_path)
                                            # Update verse information
                                            verse.tts_path = new_audio_path
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

    finally:
        db_session.close()



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
    base_url = "https://api.vachanengine.org/v2/ai/model/audio/generate"
    model_name = "seamless-m4t-large" 
    api_token = "ory_st_mby05AoClJAHhX9Xlnsg1s0nn6Raybb3"
    print("AUDIO_LAN",audio_lang)
    params = {
        "model_name": model_name,
        "language": audio_lang,  
    }
    data_payload = [  text ]
    headers = {"Authorization": f"Bearer {api_token}"}

    try:
        response = requests.post(base_url, params=params, json=data_payload, headers=headers)
        logging.info(f"AI API Response: {response.status_code} - {response.text}")
        if response.status_code == 201:
            return response.json() 
        else:
            logging.error(f"AI API Error: {response.status_code} - {response.text}")
            return {"error": response.text, "status_code": response.status_code}
    except Exception as e:
        logging.error(f"Error in call_tts_api: {str(e)}")
        return {"error": str(e)}
    

    