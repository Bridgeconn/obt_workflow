# scribe_stt
A UI for a Project based approach to convert a scribe audio project to usfm text files

## Prerequisites

Ensure you have the following installed on your machine:

- **Node.js** (v18 or later)

## Getting Started

Follow these steps to set up the project locally:

1. **Clone the Repository**

   Open your terminal and run:

   ```bash
   git clone https://github.com/Bridgeconn/scribe_stt.git
   cd scribe_stt
   ```

2. **Install Dependencies**

   Use npm to install the project dependencies:

   ```bash
   npm install
   ```

3. **Set Up Environment Variables**

   Create a `.env` file in the root location of the project and add the following;

   ```
   NEXT_PUBLIC_BASE_URL=https://api.vachanengine.org/v2
   ApiToken=<your_api_token>
   ```

4. **Run the Development Server**

   Start the Next.js development server with:

   ```bash
   npm run dev
   ```

5. **Access the Application**

   Open your web browser and go to [http://localhost:3000](http://localhost:3000) to see your application running.
