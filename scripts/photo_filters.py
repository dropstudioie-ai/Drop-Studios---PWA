import numpy as np, sys
from PIL import Image, ImageEnhance, ImageFilter, ImageDraw, ImageFont

def vibrance(im, amt):
    hsv = np.asarray(im.convert('HSV')).astype(np.float32) / 255
    s = hsv[..., 1]
    hsv[..., 1] = np.clip(s + amt * s * (1 - s) * 1.6, 0, 1)   # lifts muted colours most, protects already-strong ones
    return Image.fromarray((hsv * 255).astype(np.uint8), 'HSV').convert('RGB')

def warmth(im, r, b):
    a = np.asarray(im).astype(np.float32)
    a[..., 0] *= r; a[..., 2] *= b
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))

def curve(im, lift=0.0, gamma=1.0):
    a = np.asarray(im).astype(np.float32) / 255
    a = np.clip(lift + (1 - lift) * a ** gamma, 0, 1)
    return Image.fromarray((a * 255).astype(np.uint8))

def clarity(im, amount):
    # Local contrast scaled to the photo size, so it looks the same on a thumbnail and on the full photo.
    return im.filter(ImageFilter.UnsharpMask(radius=max(2, im.width * 0.012), percent=int(amount * 100), threshold=3))

FILTERS = {
  'Original': lambda im: im,
  'Vivid': lambda im: ImageEnhance.Contrast(vibrance(clarity(im, 0.15), 0.4)).enhance(1.06),
  'Vivid Warm': lambda im: warmth(ImageEnhance.Contrast(vibrance(clarity(im, 0.15), 0.4)).enhance(1.06), 1.025, 0.975),
  'Vibrant': lambda im: ImageEnhance.Contrast(ImageEnhance.Color(vibrance(clarity(im, 0.2), 0.5)).enhance(1.15)).enhance(1.1),
  'Vibrant Pop': lambda im: warmth(ImageEnhance.Contrast(ImageEnhance.Color(vibrance(clarity(im, 0.25), 0.6)).enhance(1.28)).enhance(1.14), 1.03, 0.97),
}

# Drop's choices: website photos use "Vivid Warm"; Instagram Story copies use "Vibrant".
WEBSITE = 'Vivid Warm'
INSTAGRAM = 'Vibrant'

if __name__ == '__main__':
    # python3 scripts/photo_filters.py "Vivid Warm" in.jpg out.webp
    name, src, out = sys.argv[1:4]
    FILTERS[name](Image.open(src).convert('RGB')).save(out, quality=86)
