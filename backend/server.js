const frontendPath = path.join(__dirname, '..', 'frontend');
const imagesPath = path.join(__dirname, '..', 'images');
app.use(express.static(frontendPath));
app.use('/images', express.static(imagesPath));
