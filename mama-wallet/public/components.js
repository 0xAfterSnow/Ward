export function el(tag, content, className) {
  const element = document.createElement(tag);
  if (content !== undefined) element.textContent = content;
  if (className) element.className = className;
  return element;
}

export function button(label, action, className = "outline", key = label) {
  const element = el("button", label, className);
  element.type = "button";
  element.dataset.focus = key;
  element.addEventListener("click", action);
  return element;
}

export function link(label, href) {
  const element = el("a", label, "text-link");
  element.href = href;
  return element;
}

// Hugeicons core-free-icons 4.4.0, MIT. Vendored SVG data; no runtime dependency.
const iconData = {
  "home": [
    [
      "path",
      {
        "d": "M3 11.9896V14.5C3 17.7998 3 19.4497 4.02513 20.4749C5.05025 21.5 6.70017 21.5 10 21.5H14C17.2998 21.5 18.9497 21.5 19.9749 20.4749C21 19.4497 21 17.7998 21 14.5V11.9896C21 10.3083 21 9.46773 20.6441 8.74005C20.2882 8.01237 19.6247 7.49628 18.2976 6.46411L16.2976 4.90855C14.2331 3.30285 13.2009 2.5 12 2.5C10.7991 2.5 9.76689 3.30285 7.70242 4.90855L5.70241 6.46411C4.37533 7.49628 3.71179 8.01237 3.3559 8.74005C3 9.46773 3 10.3083 3 11.9896Z",
        "stroke": "currentColor",
        "strokeLinecap": "round",
        "strokeLinejoin": "round",
        "strokeWidth": "1.5",
        "key": "0"
      }
    ]
  ],
  "activity": [
    [
      "path",
      {
        "d": "M19 10.5V9.99995C19 6.22876 18.9999 4.34311 17.8284 3.17154C16.6568 2 14.7712 2 11 2C7.22889 2 5.34326 2.00006 4.17169 3.17159C3.00015 4.34315 3.00013 6.22872 3.0001 9.99988L3.00006 14.5C3.00003 17.7874 3.00002 19.4312 3.90794 20.5375C4.07418 20.7401 4.25992 20.9258 4.46249 21.0921C5.56883 22 7.21255 22 10.5 22",
        "stroke": "currentColor",
        "strokeLinecap": "round",
        "strokeLinejoin": "round",
        "strokeWidth": "1.5",
        "key": "0"
      }
    ],
    [
      "path",
      {
        "d": "M7 7H15M7 11H11",
        "stroke": "currentColor",
        "strokeLinecap": "round",
        "strokeLinejoin": "round",
        "strokeWidth": "1.5",
        "key": "1"
      }
    ],
    [
      "path",
      {
        "d": "M18 18.5L16.5 17.95V15.5M12 17.5C12 19.9853 14.0147 22 16.5 22C18.9853 22 21 19.9853 21 17.5C21 15.0147 18.9853 13 16.5 13C14.0147 13 12 15.0147 12 17.5Z",
        "stroke": "currentColor",
        "strokeLinecap": "round",
        "strokeLinejoin": "round",
        "strokeWidth": "1.5",
        "key": "2"
      }
    ]
  ],
  "shield": [
    [
      "path",
      {
        "d": "M18.7088 3.49534C16.8165 2.55382 14.5009 2 12 2C9.4991 2 7.1835 2.55382 5.29116 3.49534C4.36318 3.95706 3.89919 4.18792 3.4496 4.91378C3 5.63965 3 6.34248 3 7.74814V11.2371C3 16.9205 7.54236 20.0804 10.173 21.4338C10.9067 21.8113 11.2735 22 12 22C12.7265 22 13.0933 21.8113 13.8269 21.4338C16.4576 20.0804 21 16.9205 21 11.2371L21 7.74814C21 6.34249 21 5.63966 20.5504 4.91378C20.1008 4.18791 19.6368 3.95706 18.7088 3.49534Z",
        "stroke": "currentColor",
        "strokeLinecap": "round",
        "strokeLinejoin": "round",
        "strokeWidth": "1.5",
        "key": "0"
      }
    ]
  ],
  "person": [
    [
      "path",
      {
        "d": "M20 21.0001C19.713 17.269 16.7289 14.3151 12.995 14.0662L12 13.9999C11.6446 14.0096 11.3134 14.0225 11.0008 14.0378C7.3 14.2192 4.28417 17.3057 4 21.0001",
        "stroke": "currentColor",
        "strokeLinecap": "round",
        "strokeLinejoin": "round",
        "strokeWidth": "1.5",
        "key": "0"
      }
    ],
    [
      "circle",
      {
        "cx": "12",
        "cy": "6.99988",
        "r": "4",
        "stroke": "currentColor",
        "strokeLinecap": "round",
        "strokeLinejoin": "round",
        "strokeWidth": "1.5",
        "key": "1"
      }
    ]
  ],
  "plus": [
    [
      "path",
      {
        "d": "M12.001 4.00101V20.001",
        "stroke": "currentColor",
        "strokeLinecap": "round",
        "strokeLinejoin": "round",
        "strokeWidth": "1.5",
        "key": "0"
      }
    ],
    [
      "path",
      {
        "d": "M20.001 12.001L4.00098 12.001",
        "stroke": "currentColor",
        "strokeLinecap": "round",
        "strokeLinejoin": "round",
        "strokeWidth": "1.5",
        "key": "1"
      }
    ]
  ],
  "arrow": [
    [
      "path",
      {
        "d": "M9.00005 6C9.00005 6 15 10.4189 15 12C15 13.5812 9 18 9 18",
        "stroke": "currentColor",
        "strokeLinecap": "round",
        "strokeLinejoin": "round",
        "strokeWidth": "1.5",
        "key": "0"
      }
    ]
  ],
  "wallet": [
    [
      "path",
      {
        "d": "M5 3H14C14.93 3 15.395 3 15.7765 3.10222C16.8117 3.37962 17.6204 4.18827 17.8978 5.22354C18 5.60504 18 6.07003 18 7H5C3.89543 7 3 6.10457 3 5C3 3.89543 3.89543 3 5 3Z",
        "stroke": "currentColor",
        "strokeLinecap": "round",
        "strokeLinejoin": "round",
        "strokeWidth": "1.5",
        "key": "0"
      }
    ],
    [
      "path",
      {
        "d": "M3 5V15C3 17.8284 3 19.2426 3.87868 20.1213C4.75736 21 6.17157 21 9 21H15C17.8284 21 19.2426 21 20.1213 20.1213C21 19.2426 21 17.8284 21 15V13C21 10.1716 21 8.75736 20.1213 7.87868C19.2426 7 17.8284 7 15 7H7",
        "stroke": "currentColor",
        "strokeLinecap": "round",
        "strokeLinejoin": "round",
        "strokeWidth": "1.5",
        "key": "1"
      }
    ],
    [
      "path",
      {
        "d": "M21 12H19C18.535 12 18.3025 12 18.1118 12.0511C17.5941 12.1898 17.1898 12.5941 17.0511 13.1118C17 13.3025 17 13.535 17 14C17 14.465 17 14.6975 17.0511 14.8882C17.1898 15.4059 17.5941 15.8102 18.1118 15.9489C18.3025 16 18.535 16 19 16H21",
        "stroke": "currentColor",
        "strokeLinecap": "round",
        "strokeLinejoin": "round",
        "strokeWidth": "1.5",
        "key": "2"
      }
    ]
  ],
  "phone": [
    [
      "path",
      {
        "d": "M13.5 2H10.5C8.14298 2 6.96447 2 6.23223 2.73223C5.5 3.46447 5.5 4.64298 5.5 7V17C5.5 19.357 5.5 20.5355 6.23223 21.2678C6.96447 22 8.14298 22 10.5 22H13.5C15.857 22 17.0355 22 17.7678 21.2678C18.5 20.5355 18.5 19.357 18.5 17V7C18.5 4.64298 18.5 3.46447 17.7678 2.73223C17.0355 2 15.857 2 13.5 2Z",
        "stroke": "currentColor",
        "strokeLinecap": "round",
        "strokeLinejoin": "round",
        "strokeWidth": "1.5",
        "key": "0"
      }
    ],
    [
      "path",
      {
        "d": "M12.125 19H12M12.25 19C12.25 19.1381 12.1381 19.25 12 19.25C11.8619 19.25 11.75 19.1381 11.75 19C11.75 18.8619 11.8619 18.75 12 18.75C12.1381 18.75 12.25 18.8619 12.25 19Z",
        "stroke": "currentColor",
        "strokeLinecap": "round",
        "strokeLinejoin": "round",
        "strokeWidth": "1.5",
        "key": "1"
      }
    ]
  ],
  "help": [
    [
      "circle",
      {
        "cx": "12",
        "cy": "12",
        "r": "10",
        "stroke": "currentColor",
        "strokeLinecap": "round",
        "strokeLinejoin": "round",
        "strokeWidth": "1.5",
        "key": "0"
      }
    ],
    [
      "path",
      {
        "d": "M9.5 9.5C9.5 8.11929 10.6193 7 12 7C13.3807 7 14.5 8.11929 14.5 9.5C14.5 10.3569 14.0689 11.1131 13.4117 11.5636C12.7283 12.0319 12 12.6716 12 13.5",
        "stroke": "currentColor",
        "strokeLinecap": "round",
        "strokeLinejoin": "round",
        "strokeWidth": "1.5",
        "key": "1"
      }
    ],
    [
      "path",
      {
        "d": "M12.125 16.75H12M12.25 16.75C12.25 16.8881 12.1381 17 12 17C11.8619 17 11.75 16.8881 11.75 16.75C11.75 16.6119 11.8619 16.5 12 16.5C12.1381 16.5 12.25 16.6119 12.25 16.75Z",
        "stroke": "currentColor",
        "strokeLinecap": "round",
        "strokeLinejoin": "round",
        "strokeWidth": "1.5",
        "key": "2"
      }
    ]
  ],
  "check": [
    [
      "path",
      {
        "d": "M5 14L8.5 17.5L19 6.5",
        "stroke": "currentColor",
        "strokeLinecap": "round",
        "strokeLinejoin": "round",
        "strokeWidth": "1.5",
        "key": "0"
      }
    ]
  ],
  "backspace": [
    [
      "path",
      {
        "d": "M18.8516 16.3743L19.5 6H4.5L5.14839 16.3743C5.315 19.0401 5.39831 20.373 6.26426 21.1865C7.13021 22 8.46571 22 11.1367 22H12.8633C15.5343 22 16.8698 22 17.7357 21.1865C18.6017 20.373 18.685 19.0401 18.8516 16.3743Z",
        "stroke": "currentColor",
        "strokeLinecap": "round",
        "strokeLinejoin": "round",
        "strokeWidth": "1.5",
        "key": "0"
      }
    ],
    [
      "path",
      {
        "d": "M16 6H21M16 6L15.3778 4.34082C15.0007 3.33524 14.8122 2.83245 14.4402 2.50292C14.3213 2.39765 14.1904 2.3069 14.0501 2.2326C13.6109 2 13.074 2 12 2C10.926 2 10.3891 2 9.9499 2.2326C9.8096 2.3069 9.67865 2.39765 9.55982 2.50292C9.18783 2.83245 8.99928 3.33524 8.62219 4.34082L8 6M16 6H8M3 6H8",
        "stroke": "currentColor",
        "strokeLinecap": "round",
        "strokeLinejoin": "round",
        "strokeWidth": "1.5",
        "key": "1"
      }
    ],
    [
      "path",
      {
        "d": "M9.5 11V17M14.5 11V17",
        "stroke": "currentColor",
        "strokeLinecap": "round",
        "strokeLinejoin": "round",
        "strokeWidth": "1.5",
        "key": "2"
      }
    ]
  ],
  "clock": [
    [
      "circle",
      {
        "cx": "12",
        "cy": "12",
        "r": "10",
        "stroke": "currentColor",
        "strokeWidth": "1.5",
        "key": "0"
      }
    ],
    [
      "path",
      {
        "d": "M12 8V12L14 14",
        "stroke": "currentColor",
        "strokeLinecap": "round",
        "strokeLinejoin": "round",
        "strokeWidth": "1.5",
        "key": "1"
      }
    ]
  ]
};
export function icon(name) {
 const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
 svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('aria-hidden','true');
 for (const [tag, attrs] of iconData[name] || iconData.wallet) {
  const child = document.createElementNS(svg.namespaceURI, tag);
  for (const [key,value] of Object.entries(attrs)) { if (key === 'key') continue; child.setAttribute(key.replace(/[A-Z]/g, letter => '-'+letter.toLowerCase()), key === 'strokeWidth' ? '1.75' : value); }
  svg.append(child);
 }
 return svg;
}
export function avatar(name) {
  const node = el('span', name.trim().split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase(), 'avatar');
  node.setAttribute('aria-hidden', 'true');
  return node;
}
export function shield(name) {
  const chip = el('p', undefined, 'shield-chip');
  chip.append(icon('shield'), el('span', `Protected by ${name || 'your family'}`));
  return chip;
}
export function balanceValue(value, className = 'balance-number') {
  const node = el('p', undefined, className);
  const [whole, decimals = '00'] = String(value).split('.');
  node.append(el('span', `$${Number(whole).toLocaleString('en-US')}`), el('span', `.${decimals.padEnd(2, '0')}`, 'decimals'));
  return node;
}
export function keypad(input, values = ['1', '2', '5']) {
  const root = el('div', undefined, 'amount-entry');
  const chips = el('div', undefined, 'quick-amounts');
  for (const value of values) chips.append(button(`$${value}`, () => { input.value = value; input.dispatchEvent(new Event('input')); }, 'amount-chip'));
  const pad = el('div', undefined, 'keypad');
  pad.setAttribute('aria-label', 'Amount keypad');
  for (const value of ['1','2','3','4','5','6','7','8','9','.','0','Delete']) {
    const key = button(value, () => {
      if (value === 'Delete') input.value = input.value.slice(0, -1);
      else if (!(value === '.' && input.value.includes('.')) && input.value.length < 11) {
        const next = input.value + (value === '.' && !input.value ? '0.' : value);
        if (/^\d{0,8}(\.\d{0,2})?$/.test(next)) input.value = next;
      }
      input.dispatchEvent(new Event('input'));
    }, 'number-key');
    if (value === 'Delete') { key.replaceChildren(icon('backspace')); key.setAttribute('aria-label', 'Delete last digit'); }
    pad.append(key);
  }
  root.append(chips, pad);
  return root;
}
