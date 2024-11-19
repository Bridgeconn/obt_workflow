import axios from 'axios';

const apiBaseURL = process.env.NEXT_PUBLIC_BASE_URL || 'https://api.vachanengine.org/v2';
const apiToken = process.env.API_TOKEN; 

const api = axios.create({
  baseURL: apiBaseURL,
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiToken}`,
  },
});

export default api;
