const frontendPath = path.join(__dirname, '..', 'docs');
const imagesPath = path.join(__dirname, '..', 'docs', 'images');
app.use(express.static(frontendPath));
app.use('/images', express.static(imagesPath));
