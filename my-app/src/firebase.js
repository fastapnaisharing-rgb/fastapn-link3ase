import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

export const firebaseConfig = {
  apiKey: "AIzaSyAPnTji6xiFWknFSI_nTQ4ZIdqCZbhFWu0",
  authDomain: "fastapn-link3ase.firebaseapp.com",
  projectId: "fastapn-link3ase",
  storageBucket: "fastapn-link3ase.firebasestorage.app",
  messagingSenderId: "965443505251",
  appId: "1:965443505251:web:48f911c112d1d25dcf7c56",
  measurementId: "G-FTPM1VX4YL"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export default app;