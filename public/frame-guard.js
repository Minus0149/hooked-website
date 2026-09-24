// Stand-in for frame-ancestors, which a meta CSP can't express. Nothing
// embeds this app — the landing page links out to it — so being framed means
// someone else put it there.
//
// Hide first, then try to break out. The old order hid the page only if
// redirecting the top window threw — but Chrome blocks a cross-origin frame's
// top navigation without throwing (it just logs "Unsafe attempt to initiate
// navigation"), so the app stayed visible and clickable inside the frame.
(function () {
  var framed;
  try {
    framed = window.self !== window.top;
  } catch (e) {
    framed = true; // an unreadable top is a cross-origin frame
  }
  if (!framed) return;
  document.documentElement.style.display = "none";
  try {
    window.top.location = window.self.location;
  } catch (e) {
    /* blocked; the page simply stays hidden */
  }
})();
