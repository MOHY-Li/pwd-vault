/* @refresh reload */
import "./styles/global.css";
import { render } from "solid-js/web";
import { Router } from "@solidjs/router";
import App from "./App";

const root = document.getElementById("root");

if (!root) throw new Error("Root element not found");

render(
  () => (
    <Router root={App}>
      {/* Routes are handled inside App via conditional rendering */}
    </Router>
  ),
  root,
);
