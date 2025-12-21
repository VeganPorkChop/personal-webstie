const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const frontendPath = path.join(__dirname, 'frontend');
app.use(express.static(frontendPath));

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});