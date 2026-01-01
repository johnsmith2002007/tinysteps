// Meme Generator - SpongeBob Only (using Giphy)
class MemeGenerator {
    constructor() {
        this.canvas = document.getElementById('memeCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.currentTemplate = null;
        this.templateImage = new Image();
        this.templateImage.crossOrigin = 'anonymous';
        this.giphyApiKey = 'dc6zaTOxFJmzC'; // Public beta key
        this.spongebobGifs = [];
        
        this.init();
        this.loadSpongeBobGifs();
    }

    async loadSpongeBobGifs() {
        try {
            // Search for SpongeBob memes on Giphy
            const response = await fetch(`https://api.giphy.com/v1/gifs/search?api_key=${this.giphyApiKey}&q=spongebob+meme&limit=20&rating=g`);
            const data = await response.json();
            
            if (data.data && data.data.length > 0) {
                this.spongebobGifs = data.data;
                this.populateTemplateSelect();
            } else {
                console.warn('No SpongeBob GIFs found');
                this.showError('No SpongeBob memes found. Please try again later.');
            }
        } catch (error) {
            console.error('Error loading SpongeBob GIFs:', error);
            this.showError('Failed to load SpongeBob memes. Please check your connection.');
        }
    }

    populateTemplateSelect() {
        const templateSelect = document.getElementById('memeTemplate');
        
        // Clear existing options except the first one
        while (templateSelect.options.length > 1) {
            templateSelect.remove(1);
        }
        
        // Add SpongeBob GIFs to dropdown
        this.spongebobGifs.forEach((gif, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = gif.title || `SpongeBob Meme ${index + 1}`;
            templateSelect.appendChild(option);
        });
        
        // Update placeholder text
        if (templateSelect.options.length > 1) {
            templateSelect.options[0].textContent = 'Select a SpongeBob meme...';
        }
    }

    init() {
        const templateSelect = document.getElementById('memeTemplate');
        const generateBtn = document.getElementById('generateMemeBtn');
        const downloadBtn = document.getElementById('downloadMemeBtn');
        const newMemeBtn = document.getElementById('newMemeBtn');

        templateSelect.addEventListener('change', (e) => this.loadTemplate(e.target.value));
        generateBtn.addEventListener('click', () => this.generateMeme());
        downloadBtn.addEventListener('click', () => this.downloadMeme());
        newMemeBtn.addEventListener('click', () => this.resetMeme());
        
        // Auto-generate on text input
        document.getElementById('memeTopText').addEventListener('input', () => {
            if (this.currentTemplate && this.templateImage.complete) {
                this.drawMeme();
            }
        });
        document.getElementById('memeBottomText').addEventListener('input', () => {
            if (this.currentTemplate && this.templateImage.complete) {
                this.drawMeme();
            }
        });

        this.templateImage.onload = () => {
            this.setupCanvas();
            this.drawMeme();
        };

        this.templateImage.onerror = () => {
            console.warn('Image failed to load, using fallback');
            this.setupCanvasFallback();
        };
    }

    showError(message) {
        const container = document.getElementById('memeCanvasContainer');
        if (container) {
            container.innerHTML = `<div style="color: var(--accent-orange); padding: 2rem; text-align: center;">${message}</div>`;
            container.classList.remove('hidden');
        }
    }

    loadTemplate(gifIndex) {
        if (gifIndex === '' || !this.spongebobGifs[gifIndex]) {
            document.getElementById('memeCanvasContainer').classList.add('hidden');
            return;
        }

        const gif = this.spongebobGifs[gifIndex];
        // Use the still image URL for meme generation (non-animated)
        // Giphy provides images.fixed_height_still.url or images.original_still.url
        const stillUrl = gif.images.fixed_height_still?.url || 
                        gif.images.original_still?.url || 
                        gif.images.fixed_height?.url ||
                        gif.images.original?.url;
        
        this.currentTemplate = {
            url: stillUrl,
            name: gif.title || 'SpongeBob Meme'
        };
        
        if (this.currentTemplate.url) {
            this.templateImage.src = this.currentTemplate.url;
            document.getElementById('memeCanvasContainer').classList.remove('hidden');
        } else {
            this.showError('Failed to load SpongeBob meme image.');
        }
    }

    setupCanvas() {
        const container = document.getElementById('memeCanvasContainer');
        const maxWidth = 600;
        const aspectRatio = this.templateImage.height / this.templateImage.width;
        
        this.canvas.width = Math.min(maxWidth, this.templateImage.width);
        this.canvas.height = this.canvas.width * aspectRatio;
        
        this.drawMeme();
    }

    setupCanvasFallback() {
        // Fallback canvas with a simple design
        this.canvas.width = 600;
        this.canvas.height = 400;
        this.ctx.fillStyle = '#0a0e27';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.fillStyle = '#00ffff';
        this.ctx.font = 'bold 24px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('SpongeBob Meme Template', this.canvas.width / 2, this.canvas.height / 2);
    }

    drawMeme() {
        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Draw image
        if (this.templateImage.complete && this.templateImage.naturalWidth > 0) {
            this.ctx.drawImage(this.templateImage, 0, 0, this.canvas.width, this.canvas.height);
        }

        // Draw text
        const topText = document.getElementById('memeTopText').value;
        const bottomText = document.getElementById('memeBottomText').value;

        this.drawText(topText, 'top');
        this.drawText(bottomText, 'bottom');
    }

    drawText(text, position) {
        if (!text) return;

        const fontSize = Math.max(30, this.canvas.width / 20);
        this.ctx.font = `bold ${fontSize}px Impact, Arial Black, sans-serif`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        
        // Text styling
        const x = this.canvas.width / 2;
        let y;
        
        if (position === 'top') {
            y = fontSize + 20;
        } else {
            y = this.canvas.height - fontSize - 20;
        }

        // Draw stroke (outline)
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = Math.max(3, fontSize / 10);
        this.ctx.lineJoin = 'round';
        this.ctx.miterLimit = 2;
        
        // Draw fill
        this.ctx.fillStyle = '#FFFFFF';
        
        // Draw text with stroke
        this.ctx.strokeText(text.toUpperCase(), x, y);
        this.ctx.fillText(text.toUpperCase(), x, y);
    }

    generateMeme() {
        if (!this.currentTemplate) {
            alert('Please select a SpongeBob meme first!');
            return;
        }
        this.drawMeme();
    }

    downloadMeme() {
        if (!this.currentTemplate) {
            alert('Please generate a meme first!');
            return;
        }

        const link = document.createElement('a');
        link.download = `frank-spongebob-meme-${Date.now()}.png`;
        link.href = this.canvas.toDataURL();
        link.click();
    }

    resetMeme() {
        document.getElementById('memeTemplate').value = '';
        document.getElementById('memeTopText').value = '';
        document.getElementById('memeBottomText').value = '';
        document.getElementById('memeCanvasContainer').classList.add('hidden');
        this.currentTemplate = null;
    }
}

// Initialize meme generator when page loads
document.addEventListener('DOMContentLoaded', () => {
    new MemeGenerator();
});
