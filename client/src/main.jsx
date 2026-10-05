import React from 'react';
import ReactDOM from 'react-dom/client';
import { ChakraProvider } from '@chakra-ui/react';
import axios from 'axios';
import App from './App';

// Set default base URL for axios
axios.defaults.baseURL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const csrfToken = localStorage.getItem('csrfToken');
if (csrfToken) {
  axios.defaults.headers.common['x-csrf-token'] = csrfToken;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ChakraProvider>
      <App />
    </ChakraProvider>
  </React.StrictMode>
); 