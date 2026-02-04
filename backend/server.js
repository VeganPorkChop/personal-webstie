const frontendPath = path.join(__dirname, '..', 'frontend');
const imagesPath = path.join(__dirname, '..', 'frontend', 'images');
app.use(express.static(frontendPath));
app.use('/images', express.static(imagesPath));
