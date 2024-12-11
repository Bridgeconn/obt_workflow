I'll provide a step-by-step guide to set up a React Vite project with all the specified technologies.





# React Vite Project Setup with Shadcn, Tailwind, Zustand, React Query, and TypeScript

## 1. Create Vite Project with PNPM
```bash
# Create a new project
pnpm create vite@latest my-ui-app --template react-ts

# Navigate to project directory
cd my-ui-app

# Install dependencies
pnpm install
```

## 2. Install Additional Dependencies
```bash
# Tailwind CSS
pnpm add -D tailwindcss postcss autoprefixer
pnpm dlx tailwindcss init -p

# Shadcn UI
pnpm add -D @radix-ui/react-icons
pnpm add @radix-ui/react-slot class-variance-authority clsx tailwind-merge

# Zustand
pnpm add zustand

# React Query
pnpm add @tanstack/react-query @tanstack/react-query-devtools
```

## 3. Configure Tailwind CSS (tailwind.config.js)
```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        // Add other color definitions as needed
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
```

## 4. Configure CSS (src/index.css)
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
 
@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 240 10% 3.9%;
    --card: 0 0% 100%;
    --card-foreground: 240 10% 3.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 240 10% 3.9%;
    --primary: 240 5.9% 10%;
    --primary-foreground: 0 0% 98%;
    --secondary: 240 4.8% 95.9%;
    --secondary-foreground: 240 5.9% 10%;
    --muted: 240 4.8% 95.9%;
    --muted-foreground: 240 3.8% 46.1%;
    --accent: 240 4.8% 95.9%;
    --accent-foreground: 240 5.9% 10%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 0 0% 98%;
    --border: 240 5.9% 90%;
    --input: 240 5.9% 90%;
    --ring: 240 5.9% 10%;
    --radius: 0.5rem;
  }
 
  .dark {
    --background: 240 10% 3.9%;
    --foreground: 0 0% 98%;
    /* Add other dark mode color definitions */
  }
}
```

## 5. Create Zustand Store (src/stores/exampleStore.ts)
```typescript
import { create } from 'zustand';

interface ExampleStore {
  count: number;
  increment: () => void;
  decrement: () => void;
}

export const useExampleStore = create<ExampleStore>((set) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 })),
  decrement: () => set((state) => ({ count: state.count - 1 })),
}));
```

## 6. Setup React Query (src/lib/queryClient.ts)
```typescript
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 60, // 1 hour
    },
  },
});
```

## 7. Update App.tsx
```typescript
import React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';

const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      {/* Your app content */}
    </QueryClientProvider>
  );
};

export default App;
```

## 8. Install Shadcn UI Components (Example)
```bash
# Use the shadcn-ui CLI to add components
pnpm dlx shadcn-ui@latest add button
pnpm dlx shadcn-ui@latest add card
```

## 9. Project Scripts (package.json)
```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "lint": "eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0"
  }
}
```

## Additional Recommendations
- Install ESLint and Prettier for code quality
- Configure Git for version control
- Set up your IDE (VSCode recommended) with TypeScript and React extensions
```

## Troubleshooting
- Ensure all dependencies are compatible
- Check TypeScript configuration in `tsconfig.json`
- Verify Tailwind and Shadcn UI integration
- Use `pnpm` for consistent package management


Here's a comprehensive guide to setting up your React Vite project with all the specified technologies. The artifact provides step-by-step instructions, including:

1. Project initialization with Vite and TypeScript
2. Installing dependencies (Tailwind, Shadcn UI, Zustand, React Query)
3. Configuring Tailwind CSS
4. Setting up a Zustand store example
5. Configuring React Query
6. Basic application structure

A few additional tips:
- The setup uses PNPM as the package manager
- TypeScript is included by default
- Tailwind CSS is configured with a dark mode theme
- Zustand is set up with a simple counter store
- React Query is configured with default options

Would you like me to elaborate on any part of the setup or explain any specific configuration in more detail?