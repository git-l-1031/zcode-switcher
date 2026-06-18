import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

window.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
