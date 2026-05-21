import React, { useState, useRef, useCallback } from 'react';
import Icon from '../../../components/AppIcon';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_SIZE_MB = 5;

const DocumentReUpload = ({ renewal, onUpload }) => {
  const [dragOver, setDragOver] = useState(false);
  const [newDoc, setNewDoc] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [error, setError] = useState('');
  const [showComparison, setShowComparison] = useState(false);
  const [zoomNew, setZoomNew] = useState(false);
  const [zoomOld, setZoomOld] = useState(false);
  const fileInputRef = useRef(null);

  const validateFile = (file) => {
    if (!ACCEPTED_TYPES?.includes(file?.type)) {
      return 'Invalid format. Accepted: JPG, PNG, WEBP, PDF';
    }
    if (file?.size > MAX_SIZE_MB * 1024 * 1024) {
      return `File too large. Max size: ${MAX_SIZE_MB}MB`;
    }
    return null;
  };

  const handleFile = useCallback((file) => {
    setError('');
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    setNewDoc(file);
    if (file?.type?.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
    }
  }, []);

  const handleDrop = useCallback((e) => {
    e?.preventDefault();
    setDragOver(false);
    const file = e?.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleDragOver = (e) => { e?.preventDefault(); setDragOver(true); };
  const handleDragLeave = () => setDragOver(false);

  const handleFileInput = (e) => {
    const file = e?.target?.files?.[0];
    if (file) handleFile(file);
  };

  const handleSubmit = () => {
    if (!newDoc) return;
    onUpload?.(newDoc, previewUrl);
    setNewDoc(null);
    setPreviewUrl(null);
    setShowComparison(false);
  };

  const handleClear = () => {
    setNewDoc(null);
    setPreviewUrl(null);
    setError('');
    setShowComparison(false);
    if (fileInputRef?.current) fileInputRef.current.value = '';
  };

  const docTypeLabels = {
    national_id: 'National ID',
    passport: 'Passport',
    kra_pin: 'KRA PIN Certificate',
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground">Document Re-Upload</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            {docTypeLabels?.[renewal?.documentTypeKey] || renewal?.documentType}
          </p>
        </div>
        {renewal?.existingDocUrl && (
          <button
            onClick={() => setShowComparison(!showComparison)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border hover:bg-muted transition-smooth text-foreground"
          >
            <Icon name="Columns2" size={13} color="currentColor" />
            {showComparison ? 'Hide' : 'Compare'}
          </button>
        )}
      </div>
      {/* Comparison View */}
      {showComparison && renewal?.existingDocUrl && (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Current Document</p>
            <div
              className={`relative border border-border rounded-xl overflow-hidden bg-muted cursor-zoom-in transition-all ${
                zoomOld ? 'fixed inset-4 z-50 bg-black/90 flex items-center justify-center' : 'h-40'
              }`}
              onClick={() => setZoomOld(!zoomOld)}
            >
              <img
                src={renewal?.existingDocUrl}
                alt="Current document"
                className={`w-full h-full object-contain ${zoomOld ? 'max-h-full' : ''}`}
              />
              {zoomOld && (
                <button className="absolute top-3 right-3 p-1.5 bg-white/20 rounded-full" onClick={e => { e?.stopPropagation(); setZoomOld(false); }}>
                  <Icon name="X" size={14} color="white" />
                </button>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">New Document</p>
            <div
              className={`relative border border-border rounded-xl overflow-hidden bg-muted cursor-zoom-in transition-all ${
                zoomNew ? 'fixed inset-4 z-50 bg-black/90 flex items-center justify-center' : 'h-40'
              }`}
              onClick={() => previewUrl && setZoomNew(!zoomNew)}
            >
              {previewUrl ? (
                <img src={previewUrl} alt="New document" className="w-full h-full object-contain" />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <p className="text-xs">No new document</p>
                </div>
              )}
              {zoomNew && (
                <button className="absolute top-3 right-3 p-1.5 bg-white/20 rounded-full" onClick={e => { e?.stopPropagation(); setZoomNew(false); }}>
                  <Icon name="X" size={14} color="white" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Drop Zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef?.current?.click()}
        className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-smooth ${
          dragOver
            ? 'border-primary bg-primary/5'
            : newDoc
            ? 'border-green-400 bg-green-50 dark:bg-green-900/10' :'border-border hover:border-primary/50 hover:bg-muted/50'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp,.pdf"
          onChange={handleFileInput}
          className="hidden"
        />
        {newDoc ? (
          <div className="space-y-3">
            {previewUrl ? (
              <img src={previewUrl} alt="Preview" className="mx-auto max-h-32 rounded-lg object-contain" />
            ) : (
              <div className="mx-auto w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center">
                <Icon name="FileCheck" size={22} color="#16a34a" />
              </div>
            )}
            <div>
              <p className="text-sm font-medium text-foreground">{newDoc?.name}</p>
              <p className="text-xs text-muted-foreground">{(newDoc?.size / 1024)?.toFixed(1)} KB</p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="mx-auto w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
              <Icon name="Upload" size={22} color="var(--color-muted-foreground)" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Drop file here or click to browse</p>
              <p className="text-xs text-muted-foreground mt-1">JPG, PNG, WEBP, PDF · Max {MAX_SIZE_MB}MB</p>
            </div>
          </div>
        )}
      </div>
      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <Icon name="AlertCircle" size={14} color="#ef4444" />
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}
      {/* Actions */}
      {newDoc && (
        <div className="flex gap-3">
          <button
            onClick={handleClear}
            className="flex-1 px-4 py-2.5 text-sm font-medium border border-border rounded-lg hover:bg-muted transition-smooth text-foreground"
          >
            Clear
          </button>
          <button
            onClick={handleSubmit}
            className="flex-1 px-4 py-2.5 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-smooth"
          >
            Submit Document
          </button>
        </div>
      )}
    </div>
  );
};

export default DocumentReUpload;
