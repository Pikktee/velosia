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
    elif DATABASE_URL.startswith("sqlite"):
        connect_args = {"check_same_thread": False}
else:
    # Local SQLite fallback
    DATABASE_URL = "sqlite:///./vintamie.db"
    connect_args = {"check_same_thread": False}

# Diagnostic print statements for debugging Railway permissions
print("--- DATABASE INITIALIZATION DIAGNOSTICS ---", flush=True)
# Only the scheme: a server URL could carry credentials.
print(f"DATABASE_URL scheme: {DATABASE_URL.split(':', 1)[0]}", flush=True)
try:
    print(f"Current UID: {os.getuid()}", flush=True)
    print(f"Current GID: {os.getgid()}", flush=True)
    if os.path.exists('/data'):
        stat_info = os.stat('/data')
        print(f"Directory /data exists. Owner UID: {stat_info.st_uid}, GID: {stat_info.st_gid}", flush=True)
        print(f"Permissions for /data: {oct(stat_info.st_mode)[-3:]}", flush=True)
        # Test write permission
        test_file = '/data/test_write.txt'
        try:
            with open(test_file, 'w') as f:
                f.write('test')
            os.remove(test_file)
            print("✔ Directory /data is writable!", flush=True)
        except Exception as write_err:
            print(f"✖ Directory /data is NOT writable: {write_err}", flush=True)
    else:
        print("Directory /data does NOT exist.", flush=True)
except Exception as diag_err:
    print(f"Diagnostics error: {diag_err}", flush=True)
print("------------------------------------------", flush=True)

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
