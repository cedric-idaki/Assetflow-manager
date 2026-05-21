import React, { useState, useRef, useCallback } from 'react';
import Icon from '../../../components/AppIcon';

const DocumentUploadZone = ({ label, docType, onUpload, uploadedFile, onRemove, acceptedFormats = ['image/jpeg', 'image/png', 'application/pdf'] }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  const validateFile = (file) => {
    if (!acceptedFormats?.includes(file?.type)) {
      return 'Invalid format. Please upload JPG, PNG, or PDF.';
    }
    if (file?.size > 5 * 1024 * 1024) {
      return 'File too large. Maximum size is 5MB.';
    }
    return null;
  };

  const handleFile = useCallback((file) => {
    const err = validateFile(file);
    if (err) { setError(err); return; }
    setError('');
    const reader = new FileReader();
    reader.onload = (e) => {
      onUpload?.({ file, preview: e?.target?.result, name: file?.name, size: file?.size, type: file?.type });
    };
    reader?.readAsDataURL(file);
  }, [onUpload]);

  const handleDrop = useCallback((e) => {
    e?.preventDefault();
    setIsDragging(false);
    const file = e?.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleDragOver = (e) => { e?.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => setIsDragging(false);
  const handleInputChange = (e) => { const file = e?.target?.files?.[0]; if (file) handleFile(file); };

  const formatSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024)?.toFixed(1) + ' KB';
    return (bytes / (1024 * 1024))?.toFixed(1) + ' MB';
  };

  const isImage = uploadedFile?.type?.startsWith('image/');

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-foreground">{label}</label>
      {uploadedFile ? (
        <div className="relative border border-emerald-500/30 bg-emerald-500/5 rounded-xl p-3">
          <div className="flex items-start gap-3">
            {isImage ? (
              <div className="w-16 h-16 rounded-lg overflow-hidden border border-border flex-shrink-0 bg-muted">
                <img src={uploadedFile?.preview} alt={`${label} preview`} className="w-full h-full object-cover" />
              </div>
            ) : (
              <div className="w-16 h-16 rounded-xl border border-border flex-shrink-0 bg-muted flex items-center justify-center">
                <Icon name="FileText" size={24} color="var(--color-muted-foreground)" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{uploadedFile?.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{formatSize(uploadedFile?.size)}</p>
              <div className="flex items-center gap-1 mt-1">
                <Icon name="CheckCircle" size={12} color="var(--color-emerald-500, #10b981)" />
                <span className="text-xs text-emerald-500">Uploaded successfully</span>
              </div>
            </div>
            <button
              onClick={onRemove}
              className="flex-shrink-0 p-1 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors"
              title="Remove file"
            >
              <Icon name="X" size={14} color="currentColor" />
            </button>
          </div>
        </div>
      ) : (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef?.current?.click()}
          className={`border-2 border-dashed rounded-xl p-6 cursor-pointer transition-all text-center ${
            isDragging ? 'border-primary bg-primary/5 scale-[1.01]' : 'border-border hover:border-primary/50 hover:bg-muted/50'
          }`}
        >
          <div className="flex flex-col items-center gap-2">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
              isDragging ? 'bg-primary/20' : 'bg-muted'
            }`}>
              <Icon name="Upload" size={20} color={isDragging ? 'var(--color-primary)' : 'var(--color-muted-foreground)'} />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                {isDragging ? 'Drop file here' : 'Drag & drop or click to upload'}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">JPG, PNG, PDF up to 5MB</p>
            </div>
          </div>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-1.5 text-red-500">
          <Icon name="AlertCircle" size={12} color="currentColor" />
          <p className="text-xs">{error}</p>
        </div>
      )}
      <input ref={fileInputRef} type="file" accept={acceptedFormats?.join(',')} onChange={handleInputChange} className="hidden" />
    </div>
  );
};

export default DocumentUploadZone;
