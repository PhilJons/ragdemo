import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

interface PromptParams {
  projectId: string;
}

// GET /api/projects/[projectId]/prompts - Fetch all prompts for a project
export async function GET(request: Request, { params }: { params: PromptParams }) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user || !(session.user as any).oid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId } = params;
  const userOid = (session.user as any).oid;

  try {
    // Verify user has access to this project before fetching prompts
    const userProjectAccess = await prisma.userProject.findUnique({
      where: {
        userId_projectId: {
          userId: (await prisma.user.findUnique({ where: { oid: userOid }, select: { id: true } }))?.id || 'invalid-user',
          projectId: projectId,
        },
      },
    });

    if (!userProjectAccess) {
      return NextResponse.json({ error: 'Forbidden: User does not have access to this project or project does not exist.' }, { status: 403 });
    }

    const prompts = await prisma.projectPrompt.findMany({
      where: { projectId: projectId },
      orderBy: { createdAt: 'asc' },
    });
    return NextResponse.json(prompts);
  } catch (error) {
    console.error(`Error fetching prompts for project ${projectId}:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/projects/[projectId]/prompts - Create a new prompt for a project
export async function POST(request: Request, { params }: { params: PromptParams }) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user || !(session.user as any).oid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId } = params;
  const userOid = (session.user as any).oid;

  try {
    // Verify user has access to this project before creating a prompt
    const userProjectAccess = await prisma.userProject.findUnique({
      where: {
        userId_projectId: {
          userId: (await prisma.user.findUnique({ where: { oid: userOid }, select: { id: true } }))?.id || 'invalid-user',
          projectId: projectId,
        },
      },
    });

    if (!userProjectAccess) {
      return NextResponse.json({ error: 'Forbidden: User does not have access to this project or project does not exist.' }, { status: 403 });
    }

    const body = await request.json();
    const { name, content, isDefault } = body;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return NextResponse.json({ error: 'Prompt name is required.' }, { status: 400 });
    }
    if (!content || typeof content !== 'string' || content.trim() === '') {
      return NextResponse.json({ error: 'Prompt content is required.' }, { status: 400 });
    }

    const newPrompt = await prisma.projectPrompt.create({
      data: {
        name: name.trim(),
        content: content.trim(),
        projectId: projectId,
        isDefault: typeof isDefault === 'boolean' ? isDefault : false, 
      },
    });
    return NextResponse.json(newPrompt, { status: 201 });

  } catch (error: any) {
    console.error(`Error creating prompt for project ${projectId}:`, error);
    if (error.code === 'P2002' && error.meta?.target?.includes('unique_project_prompt_name')) {
      return NextResponse.json({ error: 'A prompt with this name already exists for this project.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 