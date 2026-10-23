import { app, Menu, nativeImage, Tray } from "electron";

/** 16px "X" glyph; the Template suffix lets macOS tint it for the menu bar. */
const ICON_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAANElEQVR42mNgGHbgPxSTK49XEVGacSkmSTO6JrI0U2QzVVxAURhQFAsUpQNinUlRwA5CAABxziXbIk0CrgAAAABJRU5ErkJggg==";

let tray: Tray | undefined;

/** Menu bar item with Open and Quit; kept in a module variable so GC never drops it. */
export function createTray(onOpen: () => void): void {
  const icon = nativeImage.createFromDataURL(ICON_DATA_URL);
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip("Xtend");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Xtend", click: onOpen },
      { type: "separator" },
      { label: "Quit Xtend", click: () => app.quit() },
    ]),
  );
  tray.on("click", onOpen);
}
