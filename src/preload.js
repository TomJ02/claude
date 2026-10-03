// =============================================================================
//  preload.js : pont sécurisé entre la page (renderer) et le processus
//  principal. La page n'a pas accès à Node.js ; elle ne voit que `window.petAPI`.
// =============================================================================
const { contextBridge, ipcRenderer } = require('electron');

// Abonnement à un message du processus principal.
const on = (channel) => (callback) => {
  const listener = (_event, data) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('petAPI', {
  // Page → processus principal
  ready: () => ipcRenderer.send('pet:ready'),
  setIgnoreMouse: (ignore) => ipcRenderer.send('pet:ignore-mouse', !!ignore),
  setDragging: (dragging) => ipcRenderer.send('pet:dragging', !!dragging),
  moveToDisplayAt: (x, y) => ipcRenderer.send('pet:display-at', { x, y }),
  trackWindow: (id) => ipcRenderer.send('pet:track-window', id ?? null),
  showMenu: () => ipcRenderer.send('pet:show-menu'),

  // Processus principal → page
  onInit: on('pet:init'),
  onWorld: on('pet:world'),
  onSettings: on('pet:settings'),
  onLedges: on('pet:ledges'),
  onLedgeMove: on('pet:ledge-move'),
  onUserIdle: on('pet:user-idle'),
  onVisibility: on('pet:visibility'),
  onCommand: on('pet:command'),
});
