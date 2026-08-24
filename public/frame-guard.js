// Stand-in for frame-ancestors, which a meta CSP can't express. Nothing
// embeds this app — the landing page links out to it — so being framed means
// someone else put it there, and the session cookie is in play.
if (window.top !== window.self) {
  try {
    window.top.location = window.self.location;
  } catch {
    document.documentElement.style.display = "none";
  }
}
