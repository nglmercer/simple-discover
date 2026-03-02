import { Discovery } from '../src/Discovery.js';

const d1 = new Discovery({ id: "1" }, 3000);
const d2 = new Discovery({ id: "2" }, 3001);

d1.on("online", (s) => console.log("d1 found", s.id));
d2.on("online", (s) => console.log("d2 found", s.id));

d1.start();
d2.start();

setTimeout(() => {
  d1.stop();
  d2.stop();
  process.exit();
}, 2000);
