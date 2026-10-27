// A first visit to "/" opens on the tour's welcome step. index.html already
// carries that step as plain HTML; this flag shows it, so the promise is on
// screen before the app's script has downloaded. Anyone who has done the tour,
// or who opened any other address, gets the plain background until the app
// mounts. Loaded in <head> on purpose (the CSP allows no inline script).
try {
  if (location.pathname === "/" && localStorage.getItem("hooked.onboarded.v1") !== "1") {
    document.documentElement.setAttribute("data-boot", "tour");
  }
} catch (e) {
  /* storage blocked: no pre-paint, the app still mounts */
}
