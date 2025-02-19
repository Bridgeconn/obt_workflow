# OBT WORKFLOW - Developer Documentation

## Project Overview

This project consists of two main components:
1. **Backend**: Built using Python with FastAPI.
2. **UI**: Built using a React ,JavaScript framework.

---

## Backend Setup

### **Objective**
The backend serves as the API layer for managing users, projects, and AI-based processing.

### **Technology Stack**
- **Programming Language**: Python 3.10+
- **Web Framework**: FastAPI
- **Database**: PostgreSQL
- **ORM**: SQLAlchemy
- **Audio Processing**: Librosa
- **Authentication**: JWT
- **Task Management**: Background tasks with FastAPI


### **Installation Steps**


The following steps are tailored for **Ubuntu**. If you are on **Windows**, modifications to the commands and setup may be required.

#### **1. Set up locally for development**

Follow the fork-and-merge Git workflow:
- Fork the repo: [AI OBT Backend Repository](https://github.com/Bridgeconn/obt_workflow.git) to your GitLab account.

#### **2. Clone the Git Repository**
```bash
git clone https://github.com/Bridgeconn/obt_workflow.git
```

#### **3. Set up Virtual Environment**
```bash
python3 -m venv ENV
source ENV/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```
*Note*: If there is any issue while installing `psycopg2`, try installing `psycopg2-binary` instead.

#### **4. Set up PostgreSQL Database**

**Prerequisite**: PostgreSQL (refer to the [PostgreSQL website](https://www.postgresql.org/download/linux/ubuntu/) for installation and setup).

1. Log in to `psql`:
   ```bash
   sudo -i -u postgres
   psql
   ```
2. Create a new database:
   ```sql
   CREATE DATABASE db_name;
   ```
3. Exit:
   ```bash
   \q
   ```

#### **5. Set up Environmental Variables**

Go to the home directory and open the `.bashrc` file:
```bash
cd
gedit .bashrc
```

Add the following:
```bash
export VACHAN_POSTGRES_HOST="localhost"
export VACHAN_POSTGRES_PORT="5432"
export VACHAN_POSTGRES_USER="<db_user>"
export VACHAN_POSTGRES_PASSWORD="<db_password>"
export VACHAN_POSTGRES_DATABASE="<db_name>"
```
Refresh:
```bash
source ~/.bashrc
```

#### **6. Configuration**
1. Create and update the `.env` file with the following variables:
   - `BASE_DIRECTORY` path. (e.g., `BASE_DIRECTORY=/home/user/Desktop/obt-workflow`)
   - `FRONTEND_URL` (e.g., `FRONTEND_URL=http://localhost:3000`)
   - `SENDGRID_API_KEY` (e.g., `SENDGRID_API_KEY=your_sendgrid_api_key`)
   - `MAIL_FROM` (e.g., `MAIL_FROM=your_sendgrid_email`)
   - `API_TOKEN`(e.g.,`API_TOKEN`)
   - `BASE_URL`(e.g.,`/ai/api`)
2. Ensure the database is configured and accessible.

#### **7. Run the App**
Navigate to the `BACKEND` folder and execute:
```bash
uvicorn main:app --reload
```

#### **8. Docker Deployment**

Ensure `.env` file is created in the docker folder with following variables.
   ```bash
   AI_OBT_POSTGRES_HOST=localhost
   AI_OBT_POSTGRES_PORT=5432
   AI_OBT_POSTGRES_USER=<username>
   AI_OBT_POSTGRES_PASSWORD=<password>
   AI_OBT_POSTGRES_DATABASE=<database_name>
   AI_OBT_DOMAIN=http://localhost
   AI_OBT_DATA_PATH=<base_directory_path>
   FRONTEND_URL=http://localhost
   SENDGRID_API_KEY=<sendgrid_api_key>
   MAIL_FROM=<sendgrid_registered_mail>
   API_TOKEN=API_TOKEN
   BASE_URL=BASE_URL
   DEVICE=<devicename>

   ```

From the `docker` folder, execute:
```bash
docker-compose up --build
```
To stop:
```bash
docker-compose down
```

#### **9. Access Documentation**
- Swagger: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- Redoc: [http://127.0.0.1:8000/redoc](http://127.0.0.1:8000/redoc)

### **Deployment**
1. Clone the repository to the server.
2. Set up **Nginx** for reverse proxy:
   - Create a configuration file in `/etc/nginx/sites-available/ai_obt_backend`:
     ```
     server {
         listen 80;
         server_name your_domain_or_IP;

         location / {
             proxy_pass http://127.0.0.1:8000;
             proxy_set_header Host $host;
             proxy_set_header X-Real-IP $remote_addr;
             proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
         }
     }
     ```
   - Enable the site:
     ```bash
     sudo ln -s /etc/nginx/sites-available/ai_obt_backend /etc/nginx/sites-enabled/
     sudo systemctl restart nginx
     ```

3. Use Docker Compose to build and run the backend application:
   ```bash
   docker-compose up --build -d
   ```

---

### **Log Files**
- Logs are stored on the server and can be accessed through an API endpoint restricted to admin users.
- Example endpoint: `/admin/logs`



## UI 

#### **Technologies Used**

The frontend is built using modern and efficient technologies:

- **React**: For building the user interface.
- **Vite**: A fast and modern development tool for bundling and running the app.
- **TypeScript**: For type-safe JavaScript development.
- **Zustand**: For state management.
- **React TanStack Query**: For server-state management.
- **Tailwind CSS**: For utility-first CSS styling.
- **Shadcn UI**: For pre-styled UI components.

#### **Setup Steps**

1. **Check if Node.js is Installed**  
   Run:
   ```bash
   node --version
   ```

2. **Check if npm is Installed**  
   Run:
   ```bash
   npm --version
   ```

3. **Install Node.js**  
   - Visit [Node.js](https://nodejs.org/).
   - Download the **LTS** version.

4. **Install pnpm Globally**  
   ```bash
   npm install -g pnpm
   ```

5. **Navigate to the UI Folder**  
   ```bash
   cd UI
   ```

6. **Install Dependencies**  
   ```bash
   pnpm install
   ```

7. **Create an Environment File**  
   - In the UI root, create `.env` and add:
     ```bash
     VITE_BASE_URL="BASE_URL"
     VITE_AI_BASE_URL="AI_BASE_URL"
     ```

8. **Run the Development Server**  
   ```bash
   pnpm run dev
   ```

---

### **UI Deployment**
The UI side of the project is deployed using **Vercel** for fast and seamless deployment.



## Issues and Enhancements

### **Completed Issues**
- Backend APIs for users and projects.
  - User management.
  - Project upload and processing.
  - AI integrations for text and speech.

- UI integrated with backend

### **Pending Issues**
- Refactoring UI components for responsiveness.


---

### **Issues to decide**
- 


---

## Debugging

### **Backend**
1. Check server logs: `/logs/app.log`.
2. Use FastAPI's `/docs` to test APIs interactively.


### **UI**
1. Use browser developer tools to debug.
2. Check the console for JavaScript errors.
3. Verify API calls using tools like Postman.

---

#### **Documents Referenced**

This document setup and configuration were aided by the **SRS Document**.  
You can refer to the **[SRS Document](https://bridgeconn.sharepoint.com/:w:/s/DevTeam-AgMT-VachanAPI/EVilCVAvqmBHvzsdZZNA69ABafqb3Ly4a3sZsl3P2oPVPQ?wdOrigin=TEAMS-WEB.undefined_ns.rwc&wdExp=TEAMS-TREATMENT&wdhostclicktime=1736239716356&web=1)** for a detailed overview of the project requirements and structure.


## Conclusion
This documentation provides an overview of the project setup, development workflow, and debugging techniques for both the backend and UI components. Follow the outlined steps for a smooth development and deployment process.


