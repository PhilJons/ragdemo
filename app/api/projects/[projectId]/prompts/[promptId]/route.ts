import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

interface PromptIdParams {
  projectId: string;
  promptId: string;
}

// Helper to check user project access
async function verifyUserProjectAccess(userOid: string, projectId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { oid: userOid }, select: { id: true } });
  if (!user) return false;

  const userProjectAccess = await prisma.userProject.findUnique({
    where: {
      userId_projectId: {
        userId: user.id,
        projectId: projectId,
      },
    },
  });
  return !!userProjectAccess;
}

// PUT /api/projects/[projectId]/prompts/[promptId] - Update a specific prompt
export async function PUT(request: Request, { params }: { params: PromptIdParams }) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user || !(session.user as any).oid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId, promptId } = params;
  const userOid = (session.user as any).oid;

  try {
    if (!await verifyUserProjectAccess(userOid, projectId)) {
      return NextResponse.json({ error: 'Forbidden: User does not have access to this project or project does not exist.' }, { status: 403 });
    }

    const body = await request.json();
    const { name, content, isDefault } = body;

    if (name && (typeof name !== 'string' || name.trim() === '')) {
      return NextResponse.json({ error: 'Prompt name must be a non-empty string if provided.' }, { status: 400 });
    }
    if (content && (typeof content !== 'string' || content.trim() === '')) {
      return NextResponse.json({ error: 'Prompt content must be a non-empty string if provided.' }, { status: 400 });
    }

    const updatedPrompt = await prisma.projectPrompt.updateMany({
      where: {
        id: promptId,
        projectId: projectId, // Ensure the prompt belongs to the specified project
      },
      data: {
        name: name?.trim(),
        content: content?.trim(),
        isDefault: typeof isDefault === 'boolean' ? isDefault : undefined,
      },
    });

    if (updatedPrompt.count === 0) {
      return NextResponse.json({ error: 'Prompt not found or not part of the specified project.' }, { status: 404 });
    }
    
    // Fetch the updated prompt to return it
    const promptToReturn = await prisma.projectPrompt.findUnique({ where: { id: promptId } });
    return NextResponse.json(promptToReturn);

  } catch (error: any) {
    console.error(`Error updating prompt ${promptId} for project ${projectId}:`, error);
    if (error.code === 'P2002' && error.meta?.target?.includes('unique_project_prompt_name')) {
      return NextResponse.json({ error: 'A prompt with this name already exists for this project.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/projects/[projectId]/prompts/[promptId] - Delete a specific prompt
export async function DELETE(request: Request, { params }: { params: PromptIdParams }) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user || !(session.user as any).oid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId, promptId } = params;
  const userOid = (session.user as any).oid;

  try {
    if (!await verifyUserProjectAccess(userOid, projectId)) {
      return NextResponse.json({ error: 'Forbidden: User does not have access to this project or project does not exist.' }, { status: 403 });
    }

    const deleteResult = await prisma.projectPrompt.deleteMany({
      where: {
        id: promptId,
        projectId: projectId, // Ensure the prompt belongs to the specified project
      },
    });

    if (deleteResult.count === 0) {
      return NextResponse.json({ error: 'Prompt not found or not part of the specified project.' }, { status: 404 });
    }

    return new Response(null, { status: 204 }); // Successfully deleted, no content

  } catch (error) {
    console.error(`Error deleting prompt ${promptId} for project ${projectId}:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 