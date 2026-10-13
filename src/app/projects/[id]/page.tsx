import { ProjectPage } from '@/features/projects/editor';
export default async function Page({ params }: { params: Promise<{ id: string }> }) { return <ProjectPage id={(await params).id} />; }
