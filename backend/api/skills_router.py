from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List
import sys
import os

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

import skills

router = APIRouter()

class SkillBase(BaseModel):
    label: str
    icon: str
    description: str
    injection: str
    enabled: bool = True

class SkillCreate(SkillBase):
    id: str

class SkillUpdate(BaseModel):
    label: Optional[str] = None
    icon: Optional[str] = None
    description: Optional[str] = None
    injection: Optional[str] = None
    enabled: Optional[bool] = None

@router.get("/manage")
async def get_all_skills():
    """Retrieve all skills (including injection text) for management UI."""
    return {"skills": skills.get_all_skills_full()}

@router.post("/manage")
async def create_new_skill(payload: SkillCreate):
    """Create a new skill."""
    success = skills.create_skill(payload.dict())
    if not success:
        raise HTTPException(status_code=400, detail="Skill with this ID already exists.")
    return {"status": "success", "message": "Skill created successfully."}

@router.put("/manage/{skill_id}")
async def update_existing_skill(skill_id: str, payload: SkillUpdate):
    """Update an existing skill."""
    success = skills.update_skill(skill_id, payload.dict(exclude_unset=True))
    if not success:
        raise HTTPException(status_code=404, detail="Skill not found.")
    return {"status": "success", "message": "Skill updated successfully."}

@router.delete("/manage/{skill_id}")
async def delete_existing_skill(skill_id: str):
    """Delete a skill."""
    success = skills.delete_skill(skill_id)
    if not success:
        raise HTTPException(status_code=404, detail="Skill not found.")
    return {"status": "success", "message": "Skill deleted successfully."}
