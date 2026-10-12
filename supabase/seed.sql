-- Sample catalogue for VB Store. Run once after schema.sql; existing rows are left alone.

insert into public.categories (name, position) values
  ('Audio', 1),
  ('Vision & AR', 2),
  ('Wearables', 3),
  ('Everyday Carry', 4)
on conflict (name) do nothing;

insert into public.products (id, name, category, series, price, mrp, description, image, badge, spec, stock, featured, position) values
  ('aura-one-pro', 'Aura One Pro Headphones', 'Audio', 'Acoustic Series', 24999, 29999, 'Planar magnetic drivers, hybrid active noise cancellation and a lightweight titanium frame built for all-day listening. Quick charge gives 8 hours of playback in 10 minutes.', 'assets/img/headphones.jpg', 'Bestseller', '58h battery / 42dB ANC', 9, true, 1),
  ('iris-spatial-glasses', 'VB Iris Spatial Glasses', 'Vision & AR', 'Vision Division', 54999, 64999, 'Dual micro-OLED optical projection with 120Hz refresh, gaze tracking and zero light leak. A private big screen for flights and train journeys.', 'assets/img/glasses.jpg', 'New', 'Dual 8K / 64g', 12, false, 2),
  ('neural-grip-ring', 'Neural Grip Ring Gen-4', 'Wearables', 'Smart Wear', 14999, 17999, 'Ceramic smart ring with continuous health tracking, gesture control and passkey sign-in. Sizes 7 to 12; mention your size in the order notes.', 'assets/img/ring.jpg', '', '7-day battery', 25, false, 3),
  ('prism-dac-amp', 'Prism Modular DAC Amp', 'Audio', 'Acoustic Series', 19999, 22999, 'Lossless 32-bit/768kHz desktop DAC and headphone amplifier with a hybrid tube stage. Balanced 4.4mm and optical outputs.', 'assets/img/dac.jpg', 'Audiophile Grade', 'Balanced 4.4mm + Optical', 7, false, 4),
  ('apex-cyberpack', 'Apex Cyberpack 24L', 'Everyday Carry', 'Carry Division', 8999, 11999, 'Waterproof commuter backpack with magnetic buckles, a padded 16-inch laptop sleeve and a power-bank passthrough. Monsoon ready.', 'assets/img/backpack.jpg', 'Waterproof', '24 litres / 820g', 30, false, 5),
  ('chrono-kinetic', 'Chrono Kinetic Smart Dial', 'Wearables', 'Kinetic Timepieces', 27999, 32999, 'Solar-charging sapphire smartwatch with ECG, GPS and UPI-ready NFC. Titanium case, rated for 100m dives.', 'assets/img/watch.jpg', 'Solar', '100m dive rated', 4, false, 6)
on conflict (id) do nothing;
