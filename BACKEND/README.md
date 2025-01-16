# AI OBT Backend Readme

## Objective

## Technology Stack

- **Programming Language**: Python 3.10+
- **Web Framework**: FastAPI
- **Database**: PostgreSQL
- **ORM**: SQLAlchemy
- **Audio Processing**: Librosa
- **Authentication**: JWT
- **Task Management**: Background tasks with FastAPI


## Installation Steps

### Set up locally for development 

We follow a fork-and-merge Git workflow:
- Fork the repo: [AI OBT Backend Repository](https://github.com/Bridgeconn/obt_workflow.git) to your GitLab account.


#### Clone the Git Repository

```bash
git clone https://github.com/Bridgeconn/obt_workflow.git
```

#### Set up Virtual Environment

```bash
python3 -m venv ENV
source ENV/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

**Note**: If there is any issue while installing `psycopg2`, try installing `psycopg2-binary` instead.

#### Set up PostgreSQL Database

**Prerequisite**: PostgreSQL (refer to the [PostgreSQL website](https://www.postgresql.org/download/linux/ubuntu/) for installation and setup).

1. Log in to `psql` (command-line interface for PostgreSQL) using your username and password:

   ```bash
   sudo -i -u postgres
   psql
   ```

2. Create a new database with your desired name:

   ```sql
   CREATE DATABASE db_name;
   ```

3. Exit from `psql`:

   ```bash
   \q
   ```

4. Exit from the PostgreSQL terminal:

   ```bash
   exit
   ```

#### Set up Environmental Variables

Go to the home directory and open the `.bashrc` file:

```bash
cd
gedit .bashrc
```

Edit the following contents appropriately and paste them into the `.bashrc` file:

```bash
export VACHAN_POSTGRES_HOST="localhost"
export VACHAN_POSTGRES_PORT="5432"
export VACHAN_POSTGRES_USER="<db_user>"
export VACHAN_POSTGRES_PASSWORD="<db_password>"
export VACHAN_POSTGRES_DATABASE="<db_name>"
```


After editing the `.bashrc` file, refresh it by running:

```bash
. ~/.bashrc
```

or:

```bash
source ~/.bashrc
```

Alternatively, log out and log back in to refresh the `.bashrc` file.

#### Configuration

1. Create and update the `.env` file with `BASE_DIRECTORY` path. (e.g., `BASE_DIRECTORY=/home/user/Desktop/obt-workflow`)
2. Ensure the database is configured and accessible.


#### Run the App

From the `cd BACKEND` folder:



Run the application:

   ```bash
   uvicorn main:app --reload
   ```

If all goes well, you should see the following message in the terminal:

```bash
INFO:     Started server process [17599]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
```

To run the app on another port, use the `--port` option. To enable debug mode, use the `--debug` option:

```bash
uvicorn main:app --port=7000 --debug
```

#### Run the App using Docker

Ensure `.env` file is created in the docker folder with following variables.
   ```bash
   AI_OBT_POSTGRES_HOST=localhost
   AI_OBT_POSTGRES_PORT=5432
   AI_OBT_POSTGRES_USER=<username>
   AI_OBT_POSTGRES_PASSWORD=<password>
   AI_OBT_POSTGRES_DATABASE=<database_name>
   AI_OBT_DOMAIN=http://localhost
   AI_OBT_DATA_PATH=<base_directory_path>
   ```

From the `cd docker` folder:

   ```bash
    docker-compose up --build
   ```

To run the containers in detached mode

   ```bash
    docker-compose up --build -d
   ```

To check logs from your running Docker containers:

   ```bash
   docker logs <container_name>
   ```

To stop the App

   ```bash
   docker-compose down

   ```



#### Access Documentation

Once the app is running, access the documentation from your browser:
- Swagger Documentation: [http://127.0.0.1:8000](http://127.0.0.1:8000)
- Redoc Documentation: [http://127.0.0.1:8000](http://127.0.0.1:8000)



## Input Zip File Structures

There are three possible input zip file structures for this project.

### Structure 1

```plaintext
filename.zip
├── metadata.json
├── audio
│   └── ingredients
│       ├── <Book Name>
│       │   ├── <Chapter Number>
│       │   │   ├── <Chapter Number>_<Verse Number>.<format> (e.g., 1_1.mp3)
│       │   │   ├── ...
│       │   │   └── <Chapter Number>_<Verse Number>.<format>
│       │   └── ...
│       └── ...
├── text-1
│   └── ingredients
│       ├── <Book Name>.usfm
│       ├── scribe-settings.json
│       ├── versification.json
│       ├── license.md
│       └── ...
└── other folders (optional)
```

### Structure 2

```plaintext
filename.zip
├── metadata.json
├── ingredients
│   ├── <Book Name>
│   │   ├── <Chapter Number>
│   │   │   ├── <Chapter Number>_<Verse Number>.<format> (e.g., 1_1.mp3)
│   │   │   ├── ...
│   │   │   └── <Chapter Number>_<Verse Number>.<format>
│   │   └── ...
│   └── ...
└── other folders (optional)
```

### Structure 3

```plaintext
filename.zip
└── <Project Name> (single sub-directory)
    └── (Contains either Structure 1 or Structure 2 within it)
```

**Note**: Each of these structures should contain all necessary files and directories to ensure proper processing of the project.