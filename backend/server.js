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

async function contactPage() {
    try {
        const response = await fetch('http://localhost:3000/contact.html');
        method 