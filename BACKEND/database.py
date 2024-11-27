from sqlalchemy import create_engine, Column, Integer, String, DateTime, ForeignKey,Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import datetime
import urllib
import os
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy import create_engine, MetaData, text
from sqlalchemy.schema import CreateSchema

postgres_host = os.environ.get("VACHAN_POSTGRES_HOST", "localhost")
postgres_user = os.environ.get("VACHAN_POSTGRES_USER", "postgres")
postgres_database = os.environ.get("VACHAN_POSTGRES_DATABASE", "vachan_db")
postgres_password = os.environ.get("VACHAN_POSTGRES_PASSWORD", "secret")
postgres_port = os.environ.get("VACHAN_POSTGRES_PORT", "5432")
postgres_schema = os.environ.get("VACHAN_POSTGRES_SCHEMA", "vachan_obt")

encoded_password = urllib.parse.quote(postgres_password, safe="")


DATABASE_URL = (
    f"postgresql+psycopg2://{postgres_user}:{encoded_password}@"
    f"{postgres_host}:{postgres_port}/{postgres_database}"
    f"?options=--search_path={postgres_schema}"
)

engine = create_engine(DATABASE_URL, pool_size=10, max_overflow=20)
conn = engine.connect()
if not conn.dialect.has_schema(conn, postgres_schema):
    conn.execute(CreateSchema(postgres_schema))
    conn.commit()
conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm;"))
conn.execute(text("CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;"))
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()
metadata_obj = MetaData(schema=postgres_schema)
Base.metadata = metadata_obj

# User Table Model
class User(Base):
    __tablename__ = "usertable"
    user_id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    username = Column(String, unique=True, nullable=False)
    password = Column(String, nullable=False)
    created_date = Column(DateTime, default=datetime.datetime.utcnow)
    last_login = Column(DateTime)

# Project Table Model
class Project(Base):
    __tablename__ = "project"
    project_id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    name = Column(String, nullable=False)
    owner_id = Column(Integer, ForeignKey("usertable.user_id"), nullable=False)
    script_lang = Column(String, nullable=True)  # Script language (e.g., "eng")
    audio_lang = Column(String, nullable=True)   # Audio language (e.g., "hin")
    metadata_info = Column(String, nullable=False)




class Chapter(Base):
    __tablename__ = "chapter"
    chapter_id = Column(Integer, primary_key=True, index=True, autoincrement=True)  # Auto-increment ID1
    project_id = Column(Integer, ForeignKey("project.project_id"), nullable=False)  # Linked to Project table
    book = Column(String, nullable=False)  # Book identifier (e.g., "MAT")
    chapter = Column(Integer, nullable=False)  # Chapter number
    approved = Column(Boolean, default=False)  # Approval status (default: False)



class VerseFile(Base):
    __tablename__ = "versefile"
    verse_id = Column(Integer, primary_key=True, index=True, autoincrement=True)  # Auto-increment ID
    chapter_id = Column(Integer, ForeignKey("chapter.chapter_id"), nullable=False)  # Linked to Chapter table
    verse = Column(Integer, nullable=False)  # Verse number
    name = Column(String, nullable=False)  # File name (e.g., "1_1.wav")
    path = Column(String, nullable=False)  # Full file path
    size = Column(Integer, nullable=False)  # File size in bytes
    format = Column(String, nullable=False)  # File format (e.g., "wav")
    stt = Column(Boolean, default=False)  # Speech-to-text status
    text = Column(String, default="")  # Extracted text
    text_modified= Column(Boolean, default=False)  # Modified text
    tts = Column(Boolean, default=False) # Text-to-speech status
    tts_path = Column(String, nullable=True)
    stt_msg = Column(String, default="")  # Speech-to-text error message
    tts_msg = Column(String, default="")  # Text-to-speech error message



class Job(Base):
    __tablename__ = "jobs"

    jobid = Column(Integer, primary_key=True, autoincrement=True)  # Unique internal job ID
    verse_id = Column(Integer, ForeignKey("versefile.verse_id"))  # Linked to VerseFile table
    ai_jobid = Column(String, unique=True)  # AI server's job ID
    status = Column(String, default="pending")  # pending, in_progress, completed, failed


# Create Tables in Database
def init_db():
    Base.metadata.create_all(bind=engine)
