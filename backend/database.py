from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os
from dotenv import load_dotenv

load_dotenv()

# Read from environment variable (injected by Railway for Postgres)
DATABASE_URL = os.getenv("DATABASE_URL")

connect_args = {}

if DATABASE_URL:
    # SQLAlchemy requires postgresql:// instead of postgres:// (injected by Railway)
    if DATABASE_URL.startswith("postgres://"):
        DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)
else:
    # Local SQLite fallback
    DATABASE_URL = "sqlite:///./vintamie.db"
    connect_args = {"check_same_thread": False}

engine = create_engine(
    DATABASE_URL, connect_args=connect_args
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# Dependency to get the DB session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
