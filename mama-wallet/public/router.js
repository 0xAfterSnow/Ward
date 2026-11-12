export const route = () => new URLSearchParams(location.hash.slice(1)).get('tab') || 'home';
export function transition(work) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return work();
  if (document.startViewTransition) document.startViewTransition(work).ready.catch(() => {});
  else { work(); document.querySelector('#screen').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180 }); }
}
export function navigate(tab, render) {
  history.pushState(null, '', `#tab=${tab}`);
  transition(() => { render(); document.querySelector('#main').focus({ preventScroll: true }); document.querySelector("#main").scrollTop = 0; });
}
