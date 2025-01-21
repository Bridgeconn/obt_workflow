### **Setup Steps**

1. **Check if Node.js is Installed**  
   Run:  
   ```bash
   node --version
   ```  
   *(If not installed, proceed to Step 3)*

2. **Check if npm is Installed**  
   Run:  
   ```bash
   npm --version
   ```  
   *(npm comes with Node.js; if missing, install Node.js in Step 3)*

3. **Install Node.js**  
   - Visit the [Node.js official website](https://nodejs.org/).
   - Download and install the **LTS (Long Term Support)** version.

4. **Install pnpm Globally**  
   Run:  
   ```bash
   npm install -g pnpm
   ```

5. **Verify pnpm Installation**  
   Run:  
   ```bash
   pnpm --version
   ```

6. **Navigate to the UI Folder**  
   Run:  
   ```bash
   cd UI
   ```

7. **Install Project Dependencies**  
   Run:  
   ```bash
   pnpm install
   ```

8. **Create an Environment File**  
   - In the root directory of the UI folder, create a `.env` file.
   - add the `VITE_BASE_URL` & `VITE_AI_BASE_URL` environment variables.

   example -
     ```
     VITE_BASE_URL = "YOUR_BASE_URL"
     VITE_AI_BASE_URL="AI_BASE_URL"
     ```

9. **Run the Development Server**  
   Run:  
   ```bash
   pnpm run dev
   ```

---

Now your development server should be up and running! 🎉