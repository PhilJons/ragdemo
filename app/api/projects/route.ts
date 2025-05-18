import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth'; // Corrected import path
import prisma from '@/lib/prisma'; // Assuming @ is mapped to app/ or root, and lib is under it

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session || !session.user || !(session.user as any).oid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userOid = (session.user as any).oid;

  try {
    const userWithProjects = await prisma.user.findUnique({
      where: { oid: userOid },
      include: {
        projects: { // This comes from the UserProject relation field name in User model
          include: {
            project: { // Fetch the full project details including new settings
              include: {
                activeProjectPrompt: true // Optionally include the full active prompt details
              }
            },
          },
        },
      },
    });

    if (!userWithProjects) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Extract project details (ID and name for now)
    const projects = userWithProjects.projects.map(userProject => ({
      id: userProject.project.id,
      name: userProject.project.name,
      description: userProject.project.description,
      // Include new project-specific settings
      activeProjectPromptId: userProject.project.activeProjectPromptId,
      activeGlobalPromptName: userProject.project.activeGlobalPromptName,
      temperature: userProject.project.temperature,
      maxTokens: userProject.project.maxTokens,
      // Optionally, include the full activeProjectPrompt object if needed by client
      // activeProjectPrompt: userProject.project.activeProjectPrompt, 
    }));

    return NextResponse.json(projects);

  } catch (error) {
    console.error("Error fetching projects:", error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session || !session.user || !(session.user as any).oid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userOid = (session.user as any).oid;
  let userId: string;

  try {
    // First, find the user by their OID to get their internal ID
    const user = await prisma.user.findUnique({
      where: { oid: userOid },
      select: { id: true }, // Only select the ID
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found to associate with project' }, { status: 404 });
    }
    userId = user.id;

    const body = await request.json();
    const { name, description } = body;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return NextResponse.json({ error: 'Project name is required and must be a non-empty string' }, { status: 400 });
    }

    // Create the project and link it to the user in a transaction
    const newProject = await prisma.$transaction(async (tx) => {
      const createdProject = await tx.project.create({
        data: {
          name: name.trim(),
          description: description?.trim() || null,
          // Default settings can be initialized here if desired
          temperature: 0.7, // Example default
          maxTokens: 2000,  // Example default
        },
      });

      await tx.userProject.create({
        data: {
          userId: userId,
          projectId: createdProject.id,
        },
      });
      
      return createdProject;
    });

    return NextResponse.json(newProject, { status: 201 });

  } catch (error: any) {
    console.error("Error creating project:", error);
    if (error.code === 'P2002' && error.meta?.target?.includes('name')) {
      return NextResponse.json({ error: 'A project with this name already exists.' }, { status: 409 }); // Conflict
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 