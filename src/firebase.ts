import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Configuración de Firebase proporcionada por el usuario
const firebaseConfig = {
  apiKey: "AIzaSyB2Sz78GXyQ1tKsDahMMnuY5t2AhHuIyiQ",
  authDomain: "facemash-f1e21.firebaseapp.com",
  projectId: "facemash-f1e21",
  storageBucket: "facemash-f1e21.firebasestorage.app",
  messagingSenderId: "525931048946",
  appId: "1:525931048946:web:033c6539c6b49ae8d5856b",
  measurementId: "G-6WB16NGVB2"
};

// Inicializar Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// Enumeraciones y funciones auxiliares para el manejo robusto de errores de Firestore
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: null, // No se requiere login previo para votar/agregar en esta applet de recreación
    },
    operationType,
    path
  };
  console.error('Firestore Error Details: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Función auxiliar para formatear fechas a la zona rtc/utc deseada en español según el diseño
export function formatSpTimestamp(date: Date): string {
  const months = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
  ];
  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const ampm = hours >= 12 ? 'p.m.' : 'a.m.';
  hours = hours % 12;
  hours = hours ? hours : 12; // La hora 0 debe ser 12
  
  return `${day} de ${month} de ${year} a las ${hours}:${minutes}:${seconds} ${ampm} UTC-5`;
}

// Genera un ID amigable de Firestore basado en el nombre (ej. cecilia.margo.cuycaposa.juscamayta)
export function getStudentDocumentId(name: string): string {
  return name
    .trim()
    .normalize("NFD") // Eliminar acentos/tildes para estandarizar
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "") // Mantener solo letras, números y espacios
    .replace(/\s+/g, "."); // Reemplazar grupos de espacios por un punto
}
