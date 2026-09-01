/** Açılış splash — kullanıcı tekrar tıklamasın diye ilk boyadan görünür. */

export function dismissBootSplash(message) {
  const el = document.getElementById("boot-splash");
  if (!el) return;
  const msg = document.getElementById("boot-splash-msg");
  if (msg && message) msg.textContent = message;
  el.classList.add("is-done");
  el.setAttribute("aria-busy", "false");
  window.setTimeout(() => {
    el.remove();
  }, 400);
}

export function setBootSplashMessage(text) {
  const msg = document.getElementById("boot-splash-msg");
  if (msg) msg.textContent = text;
}
