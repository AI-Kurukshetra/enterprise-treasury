'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<
  {
    children: React.ReactNode;
    title?: string;
    description?: string;
  },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    hasError: false
  };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return {
      hasError: true
    };
  }

  override componentDidCatch(error: Error) {
    console.error(error);
  }

  override render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <Card className="border-rose-200 bg-rose-50/80">
        <CardHeader>
          <CardDescription>{this.props.title ?? 'Treasury UI error'}</CardDescription>
          <CardTitle className="text-rose-950">This panel could not be rendered safely.</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-rose-800">
            {this.props.description ?? 'Reload the panel and retry the action. No payment was submitted automatically.'}
          </p>
          <Button type="button" variant="outline" onClick={() => this.setState({ hasError: false })}>
            Retry panel
          </Button>
        </CardContent>
      </Card>
    );
  }
}
