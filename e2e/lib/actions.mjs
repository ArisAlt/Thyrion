export async function clickButton(app, text, selector = 'button') {
  await app.waitFor((e, text, selector) => [...document.querySelectorAll(selector)]
    .some((b) => b.textContent.trim() === text && e.visible(b) && !b.disabled),
  [text, selector], { what: `the enabled ${text} button` });
  return app.run((e, text, selector) => e.click([...document.querySelectorAll(selector)]
    .find((b) => b.textContent.trim() === text && e.visible(b) && !b.disabled)), text, selector);
}

export async function fill(app, selector, value) {
  await app.waitFor((e, s) => e.visible(document.querySelector(s)), [selector], { what: selector });
  await app.run((e, s, v) => e.fill(document.querySelector(s), v), selector, value);
}

export async function openSession(app, name) {
  await app.waitFor((e, name) => e.visible(document.querySelector(`[data-session-row="${name}"]`)), [name], { what: `${name} in the session list` });
  await app.run((e, name) => e.dblclick(document.querySelector(`[data-session-row="${name}"]`)), name);
}
