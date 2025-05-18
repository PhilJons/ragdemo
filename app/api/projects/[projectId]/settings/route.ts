import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

interface ProjectSettingsParams {
  projectId: string;
}

// Helper to check user project access (can be moved to a shared lib if used elsewhere)
async function verifyUserProjectAccess(userOid: string, projectId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { oid: userOid }, select: { id: true } });
  if (!user) return false;
  const userProjectAccess = await prisma.userProject.findUnique({
    where: { userId_projectId: { userId: user.id, projectId: projectId } },
  });
  return !!userProjectAccess;
}

// PUT /api/projects/[projectId]/settings - Update project-specific settings
export async function PUT(request: Request, { params }: { params: ProjectSettingsParams }) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user || !(session.user as any).oid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId } = params;
  const userOid = (session.user as any).oid;

  try {
    if (!await verifyUserProjectAccess(userOid, projectId)) {
      return NextResponse.json({ error: 'Forbidden: User does not have access to this project.' }, { status: 403 });
    }

    const body = await request.json();
    const {
      activeProjectPromptId,
      activeGlobalPromptName,
      temperature,
      maxTokens
    } = body;

    // Basic validation for incoming data types
    if (activeProjectPromptId !== undefined && activeProjectPromptId !== null && typeof activeProjectPromptId !== 'string') {
      return NextResponse.json({ error: 'Invalid activeProjectPromptId' }, { status: 400 });
    }
    if (activeGlobalPromptName !== undefined && activeGlobalPromptName !== null && typeof activeGlobalPromptName !== 'string') {
      return NextResponse.json({ error: 'Invalid activeGlobalPromptName' }, { status: 400 });
    }
    if (temperature !== undefined && typeof temperature !== 'number') {
      return NextResponse.json({ error: 'Invalid temperature value' }, { status: 400 });
    }
    if (maxTokens !== undefined && typeof maxTokens !== 'number') {
      return NextResponse.json({ error: 'Invalid maxTokens value' }, { status: 400 });
    }
    
    // Logic to ensure only one type of active prompt is set
    let updateData: any = {};
    if (activeProjectPromptId) {
      updateData.activeProjectPromptId = activeProjectPromptId;
      updateData.activeGlobalPromptName = null; // Clear the other if this one is set
    } else if (activeGlobalPromptName) {
      updateData.activeGlobalPromptName = activeGlobalPromptName;
      updateData.activeProjectPromptId = null; // Clear the other if this one is set
    } else if (activeProjectPromptId === null || activeGlobalPromptName === null) {
      // Explicitly setting to null means clear both
      updateData.activeProjectPromptId = null;
      updateData.activeGlobalPromptName = null;
    }

    if (temperature !== undefined) updateData.temperature = temperature;
    if (maxTokens !== undefined) updateData.maxTokens = maxTokens;

    if (Object.keys(updateData).length === 0) {
        return NextResponse.json({ message: 'No settings provided to update' }, { status: 200 });
    }

    const updatedProject = await prisma.project.update({
      where: { id: projectId },
      data: updateData,
      include: { // Return the updated project with its settings
        activeProjectPrompt: true,
      }
    });

    return NextResponse.json(updatedProject);

  } catch (error) {
    console.error(`Error updating settings for project ${projectId}:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 