import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface PageHeaderProps {
  eyebrow: string;
  title: string;
  description: string;
  primaryAction?: React.ReactNode;
  secondaryAction?: React.ReactNode;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  primaryAction,
  secondaryAction
}: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div className="space-y-3">
        <Badge variant="outline">{eyebrow}</Badge>
        <div className="space-y-2">
          <h1 className="text-balance text-3xl font-semibold tracking-tight text-slate-950 lg:text-4xl">
            {title}
          </h1>
          <p className="max-w-3xl text-sm leading-6 text-slate-600 lg:text-base">{description}</p>
        </div>
      </div>
      {(primaryAction || secondaryAction) && (
        <div className="flex flex-wrap gap-3">
          {typeof secondaryAction === 'string' ? <Button variant="outline">{secondaryAction}</Button> : secondaryAction}
          {typeof primaryAction === 'string' ? <Button>{primaryAction}</Button> : primaryAction}
        </div>
      )}
    </div>
  );
}
