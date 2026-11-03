import { createRoot } from "react-dom/client";
import Dashboard from "../components/Dashboard";
import { pagesFetch } from "./pages-api";
import "../app/globals.css";

declare const __PAGES_BASE_PATH__: string;
const root = document.getElementById("app");
if (!root) throw new Error("The application root is missing.");
createRoot(root).render(
  <Dashboard fetcher={pagesFetch} homeHref={__PAGES_BASE_PATH__} />,
);
