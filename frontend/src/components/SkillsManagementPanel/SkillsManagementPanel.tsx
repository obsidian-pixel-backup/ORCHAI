import React, { useState, useEffect } from 'react';
import './SkillsManagementPanel.css';

export interface Skill {
  id: string;
  label: string;
  icon: string;
  description: string;
  injection: string;
  enabled: boolean;
}

export function SkillsManagementPanel() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    fetchSkills();
  }, []);

  const fetchSkills = async () => {
    try {
      setLoading(true);
      const res = await fetch('http://127.0.0.1:8000/api/skills/manage');
      if (!res.ok) throw new Error('Failed to fetch skills');
      const data = await res.json();
      setSkills(data.skills || []);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (skill: Skill) => {
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/skills/manage/${skill.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !skill.enabled })
      });
      if (!res.ok) throw new Error('Failed to update skill');
      setSkills(skills.map(s => s.id === skill.id ? { ...s, enabled: !s.enabled } : s));
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this skill?')) return;
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/skills/manage/${id}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error('Failed to delete skill');
      setSkills(skills.filter(s => s.id !== id));
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSkill) return;

    try {
      if (isCreating) {
        const res = await fetch('http://127.0.0.1:8000/api/skills/manage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(editingSkill)
        });
        if (!res.ok) throw new Error('Failed to create skill');
        setSkills([...skills, editingSkill]);
      } else {
        const res = await fetch(`http://127.0.0.1:8000/api/skills/manage/${editingSkill.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(editingSkill)
        });
        if (!res.ok) throw new Error('Failed to update skill');
        setSkills(skills.map(s => s.id === editingSkill.id ? editingSkill : s));
      }
      setEditingSkill(null);
      setIsCreating(false);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const openCreateModal = () => {
    setIsCreating(true);
    setEditingSkill({
      id: '',
      label: '',
      icon: '✨',
      description: '',
      injection: '',
      enabled: true
    });
  };

  return (
    <div className="skills-panel">
      <div className="skills-panel-header" style={{ borderBottom: 'none', paddingBottom: 0, justifyContent: 'flex-end' }}>
        <button className="add-skill-btn" onClick={openCreateModal}>+ Add Skill</button>
      </div>

      <div className="skills-list">
        {loading && <div className="skills-loading">Loading skills...</div>}
        {error && <div className="skills-error">{error}</div>}
        {!loading && skills.length === 0 && <div className="skills-empty">No skills available.</div>}
        
        {skills.map(skill => (
          <div key={skill.id} className={`skill-item ${skill.enabled ? '' : 'disabled'}`}>
            <div className="skill-item-header">
              <span className="skill-icon">{skill.icon}</span>
              <div className="skill-info">
                <h3>{skill.label}</h3>
                <p>{skill.description}</p>
              </div>
              <div className="skill-actions">
                <label className="switch">
                  <input 
                    type="checkbox" 
                    checked={skill.enabled} 
                    onChange={() => handleToggle(skill)} 
                  />
                  <span className="slider round"></span>
                </label>
              </div>
            </div>
            <div className="skill-footer-actions">
              <button onClick={() => { setEditingSkill(skill); setIsCreating(false); }}>Edit</button>
              <button className="delete-btn" onClick={() => handleDelete(skill.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>

      {editingSkill && (
        <div className="skill-modal-overlay">
          <div className="skill-modal">
            <h3>{isCreating ? 'Create New Skill' : 'Edit Skill'}</h3>
            <form onSubmit={handleSave}>
              <div className="form-group">
                <label>ID (unique string)</label>
                <input 
                  required
                  disabled={!isCreating}
                  value={editingSkill.id} 
                  onChange={e => setEditingSkill({...editingSkill, id: e.target.value})} 
                  placeholder="e.g. python_expert"
                />
              </div>
              <div className="form-group">
                <label>Label (display name)</label>
                <input 
                  required
                  value={editingSkill.label} 
                  onChange={e => setEditingSkill({...editingSkill, label: e.target.value})} 
                />
              </div>
              <div className="form-group">
                <label>Icon (emoji)</label>
                <input 
                  required
                  value={editingSkill.icon} 
                  onChange={e => setEditingSkill({...editingSkill, icon: e.target.value})} 
                />
              </div>
              <div className="form-group">
                <label>Description</label>
                <input 
                  required
                  value={editingSkill.description} 
                  onChange={e => setEditingSkill({...editingSkill, description: e.target.value})} 
                />
              </div>
              <div className="form-group">
                <label>Methodology Injection (System Prompt)</label>
                <textarea 
                  required
                  rows={8}
                  value={editingSkill.injection} 
                  onChange={e => setEditingSkill({...editingSkill, injection: e.target.value})} 
                  placeholder="Instructions for the AI when this skill is activated..."
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="cancel-btn" onClick={() => setEditingSkill(null)}>Cancel</button>
                <button type="submit" className="save-btn">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
