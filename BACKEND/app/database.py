from sqlalchemy import create_engine, Column, Integer, String, DateTime, ForeignKey,Boolean,JSON
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import datetime
import urllib
import os
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy import create_engine, MetaData, text
from sqlalchemy.schema import CreateSchema
from utils import get_password_hash  # Import from utils instead of auth

postgres_host = os.environ.get("AI_OBT_POSTGRES_HOST", "localhost")
postgres_user = os.environ.get("AI_OBT_POSTGRES_USER", "postgres")
postgres_database = os.environ.get("AI_OBT_POSTGRES_DATABASE", "vachan_db")
postgres_password = os.environ.get("AI_OBT_POSTGRES_PASSWORD", "secret")
postgres_port = os.environ.get("AI_OBT_POSTGRES_PORT", "5432")

encoded_password = urllib.parse.quote(postgres_password, safe="")


DATABASE_URL = (
    f"postgresql+psycopg2://{postgres_user}:{encoded_password}@"
    f"{postgres_host}:{postgres_port}/{postgres_database}"
)

engine = create_engine(DATABASE_URL, pool_size=10, max_overflow=20)
conn = engine.connect()
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()

class User(Base):
    __tablename__ = "user"

    user_id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    username = Column(String, unique=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    email = Column(String, unique=True, nullable=True)  
    role = Column(String, nullable=False, default="User")
    last_login = Column(DateTime, nullable=True)  
    token = Column(String, nullable=True)
    active = Column(Boolean, default=True, nullable=False)  
    created_date = Column(DateTime, default=datetime.datetime.utcnow) 

# Project Table Model
class Project(Base):
    __tablename__ = "project"
    project_id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    name = Column(String, nullable=False)
    owner_id = Column(Integer, ForeignKey("user.user_id"), nullable=False)
    script_lang = Column(String, nullable=True)  
    audio_lang = Column(String, nullable=True)
    archive = Column(Boolean, default=False)
    created_date = Column(DateTime, default=datetime.datetime.utcnow)



    
class Book(Base):
    __tablename__ = "book"
    book_id = Column(Integer, primary_key=True, index=True, autoincrement=True)  
    project_id = Column(Integer, ForeignKey("project.project_id"), nullable=False)  
    book = Column(String, nullable=False)  


class Chapter(Base):
    __tablename__ = "chapter"
    chapter_id = Column(Integer, primary_key=True, index=True, autoincrement=True)  
    book_id = Column(Integer, ForeignKey("book.book_id"), nullable=False)  
    chapter = Column(Integer, nullable=False)
    missing_verses = Column(JSON, nullable=True) 
    approved = Column(Boolean, default=False)  


class Verse(Base):
    __tablename__ = "verse"
    verse_id = Column(Integer, primary_key=True, index=True, autoincrement=True)  
    chapter_id = Column(Integer, ForeignKey("chapter.chapter_id"), nullable=False)  
    verse = Column(Integer, nullable=False)  
    name = Column(String, nullable=False)  
    path = Column(String, nullable=False)  
    size = Column(Integer, nullable=False)  
    format = Column(String, nullable=False)  
    stt = Column(Boolean, default=False)  
    text = Column(String, default="")  
    modified= Column(Boolean, default=False) 
    tts = Column(Boolean, default=False)
    tts_path = Column(String, nullable=True)
    stt_msg = Column(String, default="")  
    tts_msg = Column(String, default="") 



class Job(Base):
    __tablename__ = "jobs"

    job_id = Column(Integer, primary_key=True, autoincrement=True)  
    verse_id = Column(Integer, ForeignKey("verse.verse_id"))  
    ai_jobid = Column(String, unique=True)  
    status = Column(String, default="pending") 

# Create Tables in Database
def init_db():
    Base.metadata.create_all(bind=engine)

 # Create hardcoded Admin user
    session = SessionLocal()
    try:
        admin_user = session.query(User).filter(User.username == "OBTAdmin").first()
        if not admin_user:
            admin_user = User(
                username="OBTAdmin",
                hashed_password=get_password_hash("password"),  # Default password
                role="Admin",
                email="",  # You can customize this
                active=True,
            )
            session.add(admin_user)
            session.commit()
            print("Admin user created with default credentials")
        else:
            print("Admin user already exists. Skipping creation.")
    except Exception as e:
        session.rollback()
        print(f"Error during admin user creation: {e}")
    finally:
        session.close()