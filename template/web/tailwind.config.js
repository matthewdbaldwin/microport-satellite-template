/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './contexts/**/*.{ts,tsx}',
    // Scan the shared lib so its Tailwind classes are emitted.
    './node_modules/@matthewdbaldwin/microport-ui/dist/**/*.{js,mjs}',
  ],
  theme: { extend: {} },
  plugins: [],
};
