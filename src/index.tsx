import React from "react";
import ReactDOM from "react-dom";
import "@fontsource-variable/geist";
import "@fontsource-variable/newsreader/opsz.css";
import "./assets/styles/reset.css";
import "./assets/styles/global.css";
import "./assets/styles/style.css";
import "./assets/styles/compact.css";
import { Provider } from "react-redux";
import "./i18n";
import store from "./store";
import Router from "./router/index";
import StyleUtil from "./utils/reader/styleUtil";
import {
  initSystemFont,
  initTheme,
  applyCustomSystemCSS,
  applyAppBackgroundImage,
} from "./utils/reader/launchUtil";
import { migrateConfig } from "./utils/common";
import { initResponsive } from "./utils/responsive";
import { initNative } from "./utils/native";
import { installAnnotationCanvasRegistry } from "./utils/reader/annotationCanvas";
import { installNativeSpeechSynthesis } from "./utils/nativeSpeech";
initTheme();
initSystemFont();
migrateConfig();
applyCustomSystemCSS();
applyAppBackgroundImage();
initResponsive();
const container = document.getElementById("root")!;
ReactDOM.render(
  <Provider store={store}>
    <Router />
  </Provider>,
  container
);
StyleUtil.applyTheme();
initNative();
installAnnotationCanvasRegistry();
installNativeSpeechSynthesis();
