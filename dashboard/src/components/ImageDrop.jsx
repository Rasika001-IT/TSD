// dashboard/src/components/ImageDrop.jsx
// Featured-image drop zone for the review panel. The editor drops or picks an
// image; it's uploaded to the WordPress media library, Claude writes the alt
// text, and it's attached as the post's featured image. If the post is already
// live, the attachment is pushed immediately.
import React, { useRef, useState } from 'react';
import { api } from '../api.js';

export function ImageDrop({ itemId, featuredImage, busy, onUploaded, flash }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return flash('Please choose an image file.', true);
    setUploading(true);
    try {
      const base64 = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result).split(',')[1]); // strip data: prefix
        fr.onerror = reject;
        fr.readAsDataURL(file);
      });
      const { featuredImage: fi } = await api.uploadImage(itemId, base64, file.type, file.name);
      flash('Image uploaded — alt text generated and attached.');
      onUploaded?.(fi);
    } catch (e) {
      flash(e.message, true);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="image-drop">
      <h3>Featured image</h3>
      {featuredImage?.url && (
        <div className="current-image">
          <img src={featuredImage.url} alt={featuredImage.alt ?? ''} />
          {featuredImage.alt && <span className="alt">alt: {featuredImage.alt}</span>}
        </div>
      )}
      <div
        className={`dropzone${uploading ? ' uploading' : ''}`}
        onClick={() => !uploading && inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files?.[0]); }}
      >
        {uploading ? 'Uploading + writing alt text…' : (featuredImage?.url ? 'Drop a new image to replace' : 'Drop an image, or click to choose')}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        disabled={busy || uploading}
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
    </div>
  );
}
