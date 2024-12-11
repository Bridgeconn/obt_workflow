import React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { Button } from './components/ui/button';

const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <Button variant="default">Hello</Button>
    </QueryClientProvider>
  );
};

export default App;