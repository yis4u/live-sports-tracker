import { createRoot } from "react-dom/client";
import Dashboard from "../components/Dashboard";
import "../app/globals.css";

const root = document.getElementById("app");
if (!root) throw new Error("The application root is missing.");
createRoot(root).render(<Dashboard />);
